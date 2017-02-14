// Internal
var eventStack = require('../utils/event-stack.js');
var natives = require('../utils/natives.js');
var tooltips = require('../ui/tooltips.js');
var utils = require('../utils/utils.js');

// External
var util = require('util');

var nextRaceId = 1;

function isTextField(obj) {
    if (obj instanceof Element) {
        var tagName = obj.tagName.toLowerCase();
        return tagName === 'input' && (
            obj.type === 'number' || obj.type === 'search' ||
            obj.type === 'text' || obj.type === 'password');
    }
    return false;
}

function FormInputRaceDetector(initRacer, _$) {
    var races = [];
    this.numFocuses = 0;

    var onFocusElement = function (target, isHtmlRace) {
        ++this.numFocuses;

        var stack = eventStack.getCurrentStack();
        var history = eventStack.getHistory();

        var precedingStaticInputFields = [];

        // Find preceding input fields which are not `target`
        for (var i = 0; i < history.length; ++i) {
            var e = history[i];
            if (e.kind === 'start-HTML-tag' && e.tag === 'input') {
                var element = document.querySelector(util.format(
                    '[data-line="%s"][data-col="%s"]',
                    e.location.line, e.location.col));
                if (element && isTextField(element) && element !== target) {
                    precedingStaticInputFields.push({
                        element: element,
                        event: e,
                        index: i
                    });
                }
            }
        }

        if (!precedingStaticInputFields.length) {
            return;
        }

        // There is one or more input fields preceding the target that is being focused,
        // meaning that there is a risk that the user could already have focused
        // one of these text fields!
        precedingStaticInputFields.forEach(function (precedingStaticInputField) {
            var report = {
                id: nextRaceId++,
                elementId: precedingStaticInputField.element.id,
                name: 'input',
                kind: 'blur',
                location: precedingStaticInputField.event.location,
                isLongDelay: false,
                isHtmlRace: isHtmlRace,
                isReadOnly: precedingStaticInputField.element.readOnly || precedingStaticInputField.element.disabled,
                isTargetStaticElement: true,
                isVisible: precedingStaticInputField.event.isVisible,
                stackTrace: utils.stackTrace()
            };

            var stackIndex = stack.indexOf(precedingStaticInputField.event);
            if (stackIndex >= 0) {
                for (var i = stackIndex+1; i < stack.length; ++i) {
                    if (stack[i].isLongDelay) {
                        report.isLongDelay = true;
                        break;
                    }
                }
            }

            report.important =
                (report.isVisible.jQuery || report.isVisible.visibilityjs) &&
                !report.isReadOnly && report.isLongDelay;

            if (report.important) {
                console.info('Form-input-race detected, kind:', focus,
                    'element:', precedingStaticInputField.element);
            }

            races.push(report);
        });
    }.bind(this);

    window.HTMLElement.prototype.focus = function () {
        if (!initRacer.analysisFinished) {
            onFocusElement(this, false);
        }
        return natives.refs.HTMLElement.focus.apply(this, arguments);
    };

    this.onDeclareElement = function (element) {
        if (initRacer.analysisFinished) {
            return;
        }

        if (element.autofocus) {
            onFocusElement(element, true);
        }

        switch (element.tagName.toLowerCase()) {
            case 'input':
                var type = element.type.toLowerCase();
                if (type === 'checkbox') {
                    var newValue = !element.checked;
                    element.dataset.assignedValue = JSON.stringify(newValue);
                    element.dataset.initialValue = JSON.stringify(element.checked);
                    element.checked = newValue;
                } else if (type === 'radio') {
                    // TODO
                    element.dataset.initialValue = JSON.stringify(element.checked);
                } else if (type === 'search' || type === 'text' || type === 'password') {
                    var newValue = 'foo' + utils.getRandomInt(1000000000, 9999999999);
                    element.dataset.assignedValue = JSON.stringify(newValue);
                    element.dataset.initialValue = JSON.stringify(element.value);
                    element.value = newValue;
                } else if (type === 'number') {
                    var newValue = utils.getRandomInt(1000000000, 9999999999);
                    element.dataset.assignedValue = JSON.stringify(newValue);
                    element.dataset.initialValue = JSON.stringify(element.value);
                    element.value = newValue;
                } else if (type === 'email') {
                    var newValue = 'foo' + utils.getRandomInt(1000000000, 9999999999) + '@foo.com';
                    element.dataset.assignedValue = JSON.stringify(newValue);
                    element.dataset.initialValue = JSON.stringify(element.value);
                    element.value = newValue;
                } else if (type !== 'button' && type !== 'hidden' && type !== 'submit') {
                    console.warn('Unhandled form input type', type);
                }
                break;

            case 'select':
                var newSelectedIndex = 0;
                if (element.selectedIndex === 0 && element.options.length > 1) {
                    newSelectedIndex = 1;
                }
                if (newSelectedIndex !== element.selectedIndex) {
                    element.dataset.assignedValue = JSON.stringify(newSelectedIndex);
                    element.dataset.initialValue = JSON.stringify(element.selectedIndex);
                    element.selectedIndex = newSelectedIndex;
                }
        }
    };

    this.onUpdateFormField = function (element, kind, val) {
        if (initRacer.analysisFinished) {
            return;
        }

        var isReadOnly = element.readOnly || element.disabled;
        var report = {
            id: nextRaceId++,
            elementId: element.id,
            name: element.tagName.toLowerCase(),
            kind: kind,
            location: {
                line: parseInt(element.dataset.line),
                col: parseInt(element.dataset.col)
            },
            isLongDelay: eventStack.isElementDeclaredLongTimeAgo(element, false),
            isReadOnly: isReadOnly,
            isTargetStaticElement: initRacer.isTargetStaticElement(element),
            isValidated: false,
            isVisible: {
                jQuery: _$(element).is(':visible') &&
                    _$(element).css('visibility') !== 'hidden' &&
                    _$(element).css('opacity') !== '0',
                visibilityjs: element.isVisible()
            },
            oldValue: element.value,
            newValue: val,
            stackTrace: utils.stackTrace()
        };

        if (typeof element.dataset.initialValue === 'string') {
            report.initialValue = JSON.parse(element.dataset.initialValue);
        }

        if (typeof element.dataset.assignedValue === 'string') {
            report.isValidated = true;
            report.assignedValue = JSON.parse(element.dataset.assignedValue);
        }

        report.important = report.isTargetStaticElement && !report.isReadOnly &&
            (report.isVisible.jQuery || report.isVisible.visibilityjs) &&
            report.isLongDelay;

        races.push(report);

        if (report.important) {
            tooltips.highlight(element);
        }
    };

    /**
     * Creates a JSON report, where races are grouped by their stack trace.
     */
    this.getReport = function () {
        return races;
    };

    this.getSummary = function () {
        var summary = {
            writes: {
                total: 0,
                harmful: 0,
                validated: 0,
                staticTarget: 0,
                visibleStaticTarget: 0,
                visibleWritableStaticTarget: 0,
                visibleWritableStaticTargetWithLongDelay: 0
            },
            blurs: {
                focuses: this.numFocuses,
                total: 0,
                harmful: 0,
                totalHtml: 0,
                harmfulHtml: 0,
                staticTarget: 0,
                visibleStaticTarget: 0,
                visibleWritableStaticTarget: 0,
                visibleWritableStaticTargetWithLongDelay: 0
            }
        };

        races.forEach(function (race) {
            var category = null;
            if (race.kind !== 'blur') {
                category = summary.writes;
                category.validated +=
                    race.important && race.isValidated &&
                    race.newValue !== race.assignedValue;
            } else {
                category = summary.blurs;
                category.totalHtml += race.isHtmlRace;
                category.harmfulHtml += race.isHtmlRace && race.important;
            }
            category.total += 1;
            category.harmful += race.important;
            category.staticTarget += race.isTargetStaticElement;
            category.visibleStaticTarget += race.isTargetStaticElement &&
                (race.isVisible.jQuery || race.isVisible.visibilityjs);
            category.visibleWritableStaticTarget += race.isTargetStaticElement &&
                (race.isVisible.jQuery || race.isVisible.visibilityjs) && !race.isReadOnly;
            category.visibleWritableStaticTargetWithLongDelay +=
                race.isTargetStaticElement &&
                (race.isVisible.jQuery || race.isVisible.visibilityjs) &&
                !race.isReadOnly && race.isLongDelay;
        });

        return summary;
    };
}

module.exports = FormInputRaceDetector;
