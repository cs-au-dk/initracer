var natives = require('../utils/natives.js');
var utils = require('../utils/utils.js');

function Stats(initRacer) {
    var info = {
        eventHandlerRegistrations: {
            total: 0,
            html: 0,
            js: 0
        },
        uncaughtExceptions: {
            observation: [],
            adverse: []
        },
        urls: {
            observation: null,
            adverse: null,
            validation: null
        }
    };

    info.urls[argv.mode] = window.location.href;

    natives.refs.Element.addEventListener.call(window, 'error', function (e) {
        if (!initRacer.analysisFinished) {
            if (argv.mode === 'observation' || argv.mode === 'adverse') {
                var desc = {
                    message: e.message,
                    fileName: e.filename,
                    line: e.lineno,
                    col: e.colno
                };
                if (e.error) {
                    desc.error = {
                        message: e.error.message,
                        stack: e.error.stack
                    };
                }
                info.uncaughtExceptions[argv.mode].push(desc);
            }
        }

        return false;
    }.bind(this), false);

    this.onDeclareElement = function (element) {
        if (!initRacer.analysisFinished) {
            var attrs = element.attributes;

            // Iterate the element's attributes
            for (var i = 0; i < attrs.length; ++i) {
                var attr = attrs[i];

                // Skip attribute if it is not an inline event handler registration
                if (utils.eventHandlerAttributeNames.indexOf(attr.name) < 0) {
                    continue;
                }

                // Increment counter if it is actually a function
                var listener = element[attr.name];

                if (typeof listener === 'function') {
                    ++info.eventHandlerRegistrations.total;
                    ++info.eventHandlerRegistrations.html;
                }
            }
        }
    };

    this.onRegisterEventHandler = function (element, type, listener, useCapture, metadata) {
        if (!initRacer.analysisFinished) {
            ++info.eventHandlerRegistrations.total;
            ++info.eventHandlerRegistrations.js;
        }
    };

    this.getReport = this.getSummary = function () {
        return info;
    };
}

module.exports = Stats;
