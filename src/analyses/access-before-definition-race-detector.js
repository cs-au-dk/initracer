// Internal
var analysis = require('../utils/analysis.js');
var eventFactory = require('../utils/event-factory.js');
var eventStack = require('../utils/event-stack.js');
var natives = require('../utils/natives.js');
var objectIds = require('../utils/object-ids.js');
var reports = require('../utils/reports.js');
var scoping = require('../utils/scoping.js');
var tooltips = require('../ui/tooltips.js');
var utils = require('../utils/utils.js');

// External
var murmurhash = require('murmurhash');

var nextRaceId = 1;

function AccessBeforeDefinitionRaceDetector(initRacer, _$) {
    var races = [];
    var summary = getInitialSummary();

    var onExitListeners = [];

    function getInitialSummary() {
        return {
            user: {
                executed: 0,
                failing: 0,
                validated: 0,
                initializationErrors: 0,
                skipped: 0,
                skippedTypes: []
            },
            system: {
                executed: 0,
                failing: 0,
                validated: 0,
                initializationErrors: 0,
                skipped: 0,
                skippedTypes: []
            }
        };
    }

    this.resetSummary = function () {
        summary = getInitialSummary();
    };

    /**
     * For every event handler that gets registered on `element` via
     * an HTML attribute, execute the event handler to detect potential
     * uncaught exceptions. The uncaught exceptions that are detected
     * this way may be due to races, or deterministic errors in the program.
     */
    this.onDeclareElement = function (element) {
        Array.prototype.slice.call(element.attributes).forEach(function (attr) {
            // Skip attribute if it is not an inline event handler registration
            if (utils.eventHandlerAttributeNames.indexOf(attr.name) < 0) {
                return;
            }

            var type = attr.name.substring(2); // remove 'on' prefix
            var listener = element[attr.name];

            if (typeof listener === 'function') {
                // Execute event handler
                scoping.registerEvaluator(listener, scoping.globalEvaluator);
                enqueueEventHandlerExecution(element, type, listener, 'HTML attribute');
            }
        });
    };

    /**
     * When an event handler gets registered by a JavaScript instruction,
     * then execute it to detect potential uncaught exceptions.
     */
    this.onRegisterEventHandler = function (target, type, listener, useCapture, metadata) {
        // Execute event handler
        enqueueEventHandlerExecution(target, type, listener, metadata.kind);
    };

    /**
     * This callback is invoked with a report if an event handler
     * has crashed due to adverse mode execution.
     */
    this.onEventHandlerFailure = function (report, target) {
        report.id = nextRaceId++;

        if (target instanceof natives.refs.Element.ref && report.important) {
            tooltips.highlight(target);
        }

        races.push(report);
    };

    this.getReport = function () {
        return races;
    };

    this.getSummary = function () {
        return summary;
    };

    this.triggerExitListeners = function () {
        onExitListeners.forEach(function (f) {
            f();
        });
    };

    var enqueueEventHandlerExecution = function (target, type, listener, kind) {
        var stackTrace = utils.stackTrace();

        if (target === document) {
            if (type === 'DOMContentLoaded' || type === 'readystatechange' ||
                    /* event delegation: */
                    type === 'input' || type === 'change') {
                return;
            }
        } else if (target === window) {
            if (type === 'load' || type === 'unload' || type === 'beforeunload' ||
                    type === 'message' || type === 'popstate') {
                return;
            }
        } else if (target instanceof natives.refs.Element.ref && target.tagName.toLowerCase() === 'script') {
            if (type === 'error' || type === 'load' || type === 'readystatechange') {
                return;
            }
        } else if (target instanceof natives.refs.MessagePort.ref) {
            return;
        } else if (target instanceof natives.refs.XMLHttpRequest.ref && type === 'readystatechange') {
            return;
        }

        var callback = function () {
            var report = getRaceReport(target, type, listener, kind, analysis.getTypeErrors(listener, 2), stackTrace);
            if (!report) {
                return;
            }

            if (report.isTargetElement && report.isUserEvent &&
                    !report.isTargetVisible.jQuery && !report.isTargetVisible.visibilityjs) {
                return;
            }

            if (argv.mode === 'validation' && !reports.isFromSameRegistration(report, argv.injectionSpec.report)) {
                return;
            }

            if (executeEventHandler(target, type, listener, report) && argv.mode === 'adverse') {
                this.onEventHandlerFailure(report, target);
            }
        }.bind(this);

        if (argv.mode === 'validation') {
            // Enqueue the event handler for execution after the web page has loaded,
            // to determine if it is truly an initialization error
            onExitListeners.push(callback);
        }

        // Execute event handler eagerly when the current script exits
        if (eventStack.getCurrentEvent() != null) {
            eventStack.onExitCurrentEvent(callback);
        } else {
            callback();
        }
    }.bind(this);

    /**
     * Generates a fake event object of type `type` and invokes the event handler `listener`.
     * Returns true if the event handler crashes with an uncaught exception.
     */
    var executeEventHandler = function (target, type, listener, report) {
        var counters = report.isUserEvent ? summary.user : summary.system;
        var eventObject = eventFactory(target, type);
        var typeIsSupported = !!eventObject;

        // Check if the event factory is capable of generating an event of this type
        if (report.isListenerReadingParameter && !typeIsSupported) {
            ++counters.skipped;
            if (counters.skippedTypes.indexOf(type) < 0) {
                counters.skippedTypes.push(type);
            }
            return;
        }

        // Execute event handler
        try {
            window.event = eventObject;
            if (report.isListenerReadingParameter) {
                listener.call(target, eventObject);
            } else {
                listener.call(target);
            }
            window.event = undefined;
        } catch (e) {
            console.info('Access-before-definition error detected, type:', type, 'error:', e);

            report.isThrowingError = true;
            report.thrownError = e.toString();
            
            ++counters.failing;
        }

        ++counters.executed;

        return report.isThrowingError;
    }.bind(this);

    function getRaceReport(target, type, listener, kind, errors, stackTrace) {
        var name = utils.getTargetName(target);
        if (!name) {
            return;
        }

        var code = analysis.extractCode(listener);
        var report = {
            name: name,
            type: type,
            kind: kind,
            listener: {
                id: objectIds.getId(listener),
                hash: murmurhash.v3(code),
                characters: code.length,
                code: code
            },
            accesses: errors.map(function (error) {
                var _code = error.enclosingFunction === listener
                    ? code : analysis.extractCode(error.enclosingFunction);
                error.access.enclosingFunction = {
                    id: objectIds.getId(error.enclosingFunction),
                    hash: murmurhash.v3(_code),
                    characters: _code.length,
                    code: _code
                };
                return error.access;
            }),
            isThrowingError: false,
            thrownError: null,
            isListenerReadingParameter: analysis.isFunctionReadingParameter(listener, code),
            isTargetStaticElement: initRacer.isTargetStaticElement(target),
            isTargetElement: target instanceof natives.refs.Element.ref,
            isUserEvent: utils.userEventNames.indexOf(type) >= 0,
            stackTrace: stackTrace,
            important: true
        };

        if (report.isTargetElement) {
            report.elementId = target.id;
            report.isTargetVisible = {
                jQuery: _$(target).is(':visible') &&
                    _$(target).css('visibility') !== 'hidden' &&
                    _$(target).css('opacity') !== '0',
                visibilityjs: target.isVisible()
            };

            if (report.isTargetStaticElement) {
                report.location = {
                    line: parseInt(target.dataset.line),
                    col: parseInt(target.dataset.col)
                };
            }
        }

        return report;
    }
}

module.exports = AccessBeforeDefinitionRaceDetector;
