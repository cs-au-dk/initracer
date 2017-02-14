var eventFactory = require('../utils/event-factory.js');
var eventStack = require('../utils/event-stack.js');
var natives = require('../utils/natives.js');
var scoping = require('../utils/scoping.js');
var tooltips = require('../ui/tooltips.js');
var utils = require('../utils/utils.js');

var nextRaceId = 1;

function LateEventHandlerRegistrationRaceDetector(initRacer, _$) {
    var races = [];
    var metadata = new natives.refs.Map.ref();

    this.onRegisterEventHandler = function (target, type, listener, useCapture, metadata) {
        if (initRacer.analysisFinished) {
            console.warn('Ignoring potentially-late-event-handler-registration after initialization');
            return;
        }

        if (target instanceof natives.refs.Element.ref && target.dataset.srcModified && ['error', 'load'].indexOf(type) >= 0) {
            return;
        }

        if (target instanceof natives.refs.MessagePort.ref || target instanceof natives.refs.XMLHttpRequest.ref) {
            return;
        }

        var stackTrace = utils.stackTrace();

        function onExitCurrentEvent() {
            storeDetectedRace(target, type, listener, metadata.kind, stackTrace);
        }

        if (eventStack.getCurrentEvent() != null) {
            eventStack.onExitCurrentEvent(onExitCurrentEvent);
        } else {
            onExitCurrentEvent();
        }
    };

    this.setCallsPreventDefault = function () {
        races.forEach(function (race) {
            if (!race.isUserEvent) {
                // We do not care if the listener has called preventDefault,
                // when it is not a user event...
                return;
            }

            if (race.isTargetElement) {
                if (!race.isVisible.jQuery && !race.isVisible.visibilityjs) {
                    // We do not care if the listener has called preventDefault,
                    // when the target element is not visible anyway...
                    return;
                }
            }

            var { target, listener } = metadata.get(race);

            var eventObject = eventFactory(target, race.type);
            if (!eventObject) {
                // Type is not supported
                console.warn('Unexpected: preventDefault() detection is not supported for event type', race.type);
                return;
            }

            // Execute event handler
            try {
                window.event = eventObject;
                listener.call(target, eventObject);
                window.event = undefined;
            } catch (e) {
            }

            race.callsPreventDefault = !!eventObject.defaultPrevented;

            // Importance may have changed
            race.important = 
                race.isTargetStaticElement && race.isLongDelay &&
                (race.isVisible.jQuery || race.isVisible.visibilityjs) &&
                race.callsPreventDefault;

            if (race.isTargetElement && race.important) {
                tooltips.highlight(target);
            }
        });
    };

    this.getReport = function () {
        return races;
    };

    this.getSummary = function () {
        var summary = {
            user: {
                total: 0,
                harmful: 0,
                staticTarget: 0,
                visibleStaticTarget: 0,
                visibleStaticTargetWithLongDelay: 0,
                visibleStaticTargetWithPreventDefault: 0,
                visibleStaticTargetWithLongDelayWithPreventDefault: 0
            },
            system: {
                total: 0,
                harmful: 0,
                elementTarget: 0,
                staticElementTarget: 0,
                staticElementTargetWithLongDelay: 0
            }
        };
        races.forEach(function (race) {
            if (race.isUserEvent) {
                summary.user.total += 1;
                summary.user.harmful += race.important;
                summary.user.staticTarget += race.isTargetStaticElement;
                summary.user.visibleStaticTarget += race.isTargetStaticElement &&
                    (race.isVisible.jQuery || race.isVisible.visibilityjs);
                summary.user.visibleStaticTargetWithLongDelay +=
                    race.isTargetStaticElement && race.isLongDelay &&
                    (race.isVisible.jQuery || race.isVisible.visibilityjs);
                summary.user.visibleStaticTargetWithPreventDefault +=
                    race.isTargetStaticElement && race.callsPreventDefault &&
                    (race.isVisible.jQuery || race.isVisible.visibilityjs);
                summary.user.visibleStaticTargetWithLongDelayWithPreventDefault +=
                    race.isTargetStaticElement && race.isLongDelay &&
                    (race.isVisible.jQuery || race.isVisible.visibilityjs) &&
                    race.callsPreventDefault;
            } else {
                summary.system.total += 1;
                summary.system.harmful += race.important;
                summary.system.elementTarget += race.isTargetElement;
                summary.system.staticElementTarget += race.isTargetStaticElement;
                summary.system.staticElementTargetWithLongDelay +=
                    race.isTargetStaticElement && race.isLongDelay;
            }
        });
        return summary;
    };

    function storeDetectedRace(target, type, listener, kind, stackTrace) {
        var name = utils.getTargetName(target);
        if (!name) {
            return;
        }

        var report = {
            id: nextRaceId++,
            name: name,
            type: type,
            kind: kind,
            location: initRacer.isTargetStaticElement(target) ? {
                line: parseInt(target.dataset.line),
                col: parseInt(target.dataset.col)
            } : null,
            isLongDelay: target instanceof natives.refs.Element.ref && eventStack.isElementDeclaredLongTimeAgo(target, false),
            isVisible: target instanceof natives.refs.Element.ref ? {
                jQuery: _$(target).is(':visible') &&
                    _$(target).css('visibility') !== 'hidden' &&
                    _$(target).css('opacity') !== '0',
                visibilityjs: target.isVisible()
            } : null,
            isTargetStaticElement: initRacer.isTargetStaticElement(target),
            isTargetElement: target instanceof natives.refs.Element.ref,
            isUserEvent: utils.userEventNames.indexOf(type) >= 0,
            callsPreventDefault: false,
            stackTrace: stackTrace
        };

        if (report.isUserEvent) {
            report.important = 
                report.isTargetStaticElement && report.isLongDelay &&
                (report.isVisible.jQuery || report.isVisible.visibilityjs) &&
                report.callsPreventDefault;
        } else {
            report.important =
                report.isTargetStaticElement && report.isLongDelay;
        }

        races.push(report);

        metadata.set(report, {
            target: target,
            listener: listener
        });

        if (report.isTargetElement) {
            report.elementId = target.id;

            if (report.important) {
                tooltips.highlight(target);
            }
        }
    }
}

module.exports = LateEventHandlerRegistrationRaceDetector;
