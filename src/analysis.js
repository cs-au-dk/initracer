// Internal
var analysis = require('./utils/analysis.js');
var eventStack = window.eventStack = window.$es = require('./utils/event-stack.js');
var instrumentJavaScript = require('./instrumentation/instrument-js.js');
var natives = require('./utils/natives.js');
var runtime = require('./utils/runtime.js');
var scoping = window.scoping = require('./utils/scoping.js');
var shadowing = require('./utils/shadowing.js');
var utils = require('./utils/utils.js');

if (window !== window.parent) {
    module.exports = function () {
        return window.initRacer = window.$ir = {
            assign: function (base, offset, val) {
                return base[offset] = val;
            },
            call: function (receiver, fun, args, isConstructor, isMethod, methodName) {
                if (typeof fun !== 'function' && isMethod) {
                    throw new TypeError('callee is not a function');
                }
                if (isConstructor) {
                    return runtime.callAsConstructor(fun, args);
                }
                return fun.apply(receiver, args);
            },
            _call: function (receiver, fun, args, isConstructor, isMethod) {
                var methodName = null;
                if (isMethod) {
                    methodName = fun;
                    fun = receiver[methodName];
                } else {
                    receiver = (function () { return this; })();
                }
                return this.call(receiver, fun, args, isConstructor, isMethod, methodName);
            },
            onDeclareElement: function () {},
            jQueryLoaded: function () {},
            registerEvaluator: function (f, evaluator) { return f; },
            instrument: function (code) { return code; }
        };
    };
    return;
}

var _$ = (loadJQuery(), jQuery.noConflict(true));

function InitRacer() {
    var self = this;

    this.analysis = analysis;
    this.registerEvaluator = scoping.registerEvaluator.bind(scoping);
    this._$ = _$;

    this.analysisFinished = false;
    this.disabled = 0;

    var listeners = [];
    var wrappers = new natives.refs.Map.ref();

    /**
     * Registers an object as a listener. The listener should declare
     * at least one of the methods `onDeclareElement`, `onRegisterEventHandler`
     * or `onUpdateFormField`.
     */
    this.addListener = function (listener) {
        listeners.push(listener);
    };

    /**
     * Calls the function with the name `hook` on each of the listeners.
     */
    function notifyListeners(hook, args) {
        for (var i = 0; i < listeners.length; ++i) {
            var listener = listeners[i];
            var callback = listener[hook];
            if (typeof callback === 'function') {
                callback.apply(listener, args);
            }
        }
    }

    this.instrument = function (code) {
        if (typeof code === 'string') {
            return instrumentJavaScript(code, {
                allowReturnOutsideFunction: true,
                isExternal: false,
                url: 'N/A'
            });
        }
        return code;
    };

    /**
     * Returns true if `o` is an HTML element that has been
     * declared statically in the HTML page. This is recognized by
     * looking for the attributes `data-line` and `data-col`, which
     * are inserted by the HTML instrumentation.
     */
    this.isTargetStaticElement = function (o) {
        return !!(o instanceof natives.refs.Element.ref && o.dataset && o.dataset.line && o.dataset.col);
    };

    window.addEventListener('load', function (event) {
        natives.refs.setTimeout.call(window, function () {
            self.analysisFinished = true;
        }, 5000);
    }, false);

    /**
     * Replace the addEventListener function with a custom one, that
     * invokes the `onRegisterEventHandler` hook on each of the listeners,
     * before actually adding the event handling using the native function.
     */
    window.EventTarget.prototype.addEventListener = function (type, listener, useCapture) {
        var base = this;

        if (!self.disabled && !self.analysisFinished) {
            if (utils.eventHandlerAttributeNames.indexOf('on' + type) >= 0 && typeof listener === 'function') {
                notifyListeners('onRegisterEventHandler',
                    [this, type, listener, useCapture, { kind: 'addEventListener' }]);
            }
        }

        var wrapper = listener;
        if (typeof listener === 'function') {
            if (wrappers.has(listener)) {
                wrapper = wrappers.get(listener);
            } else {
                var enterOptions = eventStack.onRegisterEventHandler(base, type, listener, useCapture);
                wrapper = function (e) {
                    if (this instanceof natives.refs.XMLHttpRequest.ref) {
                        var intermediate = eventStack.onEnterAjaxEvent(base);
                        try {
                            return listener.apply(this, arguments);
                        } finally {
                            eventStack.onExitAjaxEvent(intermediate);
                        }
                    } else {
                        var exitOptions = eventStack.onEnterEventHandler(e, enterOptions);
                        try {
                            return listener.apply(this, arguments);
                        } finally {
                            eventStack.onExitEventHandler(exitOptions);
                        }
                    }
                };
                wrappers.set(listener, wrapper);
            }
        }
        return natives.refs.Element.addEventListener.call(this, type, wrapper, useCapture);
    };

    /**
     * Replace the removeEventListener function with a custom one, that
     * removes the wrapper introduced from our addEventListener-replacement
     * (see above) rather than the passed function.
     */
    window.EventTarget.prototype.removeEventListener = function (type, listener, useCapture) {
        var listenerToBeRemoved = listener;
        if (wrappers.has(listener)) {
            listenerToBeRemoved = wrappers.get(listener);
        }
        return natives.refs.Element.removeEventListener.call(this, type, listenerToBeRemoved, useCapture);
    };

    /**
     * Replace the setTimeout function with a custom one, that
     * invokes `onRegisterTimeout`, `onEnterTimeout` and `onExitTimeout` on the event stack.
     */
    window.setTimeout = function (x, delay) {
        var intermediate = eventStack.onRegisterTimeout(x, delay || 0);
        return natives.refs.setTimeout.call(window, function () {
            intermediate = eventStack.onEnterTimeout(intermediate);
            try {
                if (typeof x === 'function') {
                    x();
                } else if (typeof x === 'string') {
                    natives.refs.eval(instrumentJavaScript(x, {
                        allowReturnOutsideFunction: true,
                        isExternal: false,
                        url: 'N/A'
                    }));
                }
            } finally {
                eventStack.onExitTimeout(intermediate);
            }
        }, delay);
    };

    /**
     * Replace the then() function with a custom one, that
     * invokes `onRegisterPromiseCallback`, `onEnterPromiseCallback`
     * and `onExitPromiseCallback` on the event stack.
     */
    Promise.prototype.then = function (onFulfilled, onRejected) {
        return wrapPromiseThen(this, onFulfilled, onRejected, null, true);
    };

    function wrapPromiseThen(base, onFulfilled, onRejected, onProgressed, isNative) {
        var enterFulfilledOptions = eventStack.onRegisterPromiseCallback(onFulfilled, true, false);
        var enterRejectedOptions = null;
        if (onRejected) {
            enterRejectedOptions = eventStack.onRegisterPromiseCallback(onRejected, false, true)
        }

        return (isNative ? natives.refs.Promise.then : base.then).call(base,
            function () {
                if (typeof onFulfilled === 'function') {
                    var intermediate = eventStack.onEnterPromiseCallback(enterFulfilledOptions);
                    try {
                        return onFulfilled.apply(base, arguments);
                    } finally {
                        eventStack.onExitPromiseCallback(intermediate);
                    }
                }
            },
            onRejected ? function () {
                if (typeof onRejected === 'function') {
                    var intermediate = eventStack.onEnterPromiseCallback(enterRejectedOptions);
                    try {
                        return onRejected.apply(base, arguments);
                    } finally {
                        eventStack.onExitPromiseCallback(intermediate);
                    }
                }
            } : null,
            onProgressed
        );
    }

    /**
     * Replace the catch() function with a custom one, that
     * invokes `onRegisterPromiseCallback`, `onEnterPromiseCallback`
     * and `onExitPromiseCallback` on the event stack.
     */
    /*Promise.prototype.catch = function (executor) {
        var intermediate = eventStack.onRegisterPromiseCallback(executor, false, true);
        return _catch.call(this, function () {
            intermediate = eventStack.onEnterPromiseCallback(intermediate);
            try {
                executor.apply(this, arguments);
            } finally {
                eventStack.onExitPromiseCallback(intermediate);
            }
        });
    };*/

    /**
     * The JavaScript instrumentation transforms every property assignment into
     * an invocation of this function.
     *
     * This function:
     * - calls `onRegisterEventHandler` on each listener,
     *   if an "event handler property" (e.g., `onclick`)
     *   is assigned on an HTML element, and
     * - calls `onUpdateFormField` on each listener,
     *   if the value of a form field is changed (e.g.,
     *   by modifying the `value` or `checked` property of
     *   an input HTML element).
     */
    this.assign = function (base, offset, val) {
        if (typeof offset !== 'string' && typeof offset !== 'symbol') {
            offset = '' + offset;
        }

        if (!self.disabled && !self.analysisFinished) {
            if (base instanceof natives.refs.Element.ref) {
                // If we are assigning, say, the property `value` on an input HTML element,
                // then invoke `onUpdateFormField` on each listener
                var tagName = null;
                try {
                    tagName = base.tagName.toLowerCase();
                } catch (e) {}

                if ((tagName === 'input' && (offset === 'checked' || offset === 'value')) || (tagName === 'select' && offset === 'selectedIndex')) {
                    notifyListeners('onUpdateFormField', [base, offset, val]);
                }

                if (tagName === 'img' && offset === 'src') {
                    base.dataset.srcModified = 'true';
                }
            }
        }

        // If an event handler is being registered, replace it in order to maintain the event stack
        if (offset && offset.length > 2) {
            var type = offset.substring(2);

            // If we are assigning a function to an "event handler property",
            // then invoke `onRegisterEventHandler` on each listener
            if (base === document || base === window ||
                    base instanceof natives.refs.Element.ref ||
                    base instanceof natives.refs.MessagePort.ref ||
                    base instanceof natives.refs.XMLHttpRequest.ref) {
                if (typeof val === 'function' && utils.eventHandlerAttributeNames.indexOf(offset) >= 0) {
                    notifyListeners('onRegisterEventHandler',
                        [base, type, val, false, { kind: 'attribute assignment' }]);

                    var enterOptions = eventStack.onRegisterEventHandler(base, type, val, false);
                    base[offset] = function (e) {
                        if (base instanceof natives.refs.XMLHttpRequest.ref) {
                            var intermediate = eventStack.onEnterAjaxEvent(base);
                            try {
                                return val.apply(this, arguments);
                            } finally {
                                eventStack.onExitAjaxEvent(intermediate);
                            }
                        } else {
                            var exitOptions = eventStack.onEnterEventHandler(e, enterOptions);
                            try {
                                return val.apply(this, arguments);
                            } finally {
                                eventStack.onExitEventHandler(exitOptions);
                            }
                        }
                    };
                    return val;
                }
            }
        }

        if (base === window.location && offset === 'href') {
            console.warn('location.href assigned');
            return val;
        } else if ((base === document || base === window) && offset === 'location') {
            console.warn('location assigned');
            return val;
        }

        return base[offset] = val;
    };

    this.call = function (receiver, fun, args, isConstructor, isMethod, methodName) {
        if (typeof fun !== 'function') {
            throw new TypeError('callee is not a function');
        }

        var calledFunction = fun === natives.refs.Function.apply || fun === natives.refs.Function.call ? receiver : fun;
        if (calledFunction === natives.refs.location.assign || calledFunction === natives.refs.location.reload || calledFunction === natives.refs.location.replace) {
            console.warn('location.assign(), location.reload(), or location.replace() called');
            return;
        }

        // Model Q-library
        if (typeof window.Q === 'function' && typeof window.Q.makePromise === 'function') {
            if (isMethod && receiver instanceof window.Q.makePromise && methodName === 'then') {
                return wrapPromiseThen(receiver, args[0], args[1], args[2], false);
            }
        }

        // Handle eval (1)
        if (calledFunction === natives.refs.eval) {
            var code = args[0];
            if (fun === natives.refs.Function.apply) {
                code = args[1][0];
            } else if (fun === natives.refs.Function.call) {
                code = args[1];
            }
            return natives.refs.eval(instrumentJavaScript(code, {
                allowReturnOutsideFunction: true,
                isExternal: false,
                url: 'N/A'
            }));
        }

        // Handle eval (2)
        if (fun === natives.refs.Function.ref && isConstructor) {
            var code = '(function (' + args.slice(0, args.length-1).join(', ') + ') { ' + args[args.length-1] + ' })';
            return natives.refs.eval(instrumentJavaScript(code, {
                allowReturnOutsideFunction: true,
                isExternal: false,
                url: 'N/A'
            }));
        }

        if (isConstructor) {
            return runtime.callAsConstructor(fun, args);
        }
        return fun.apply(receiver, args);
    };

    this._call = function (receiver, fun, args, isConstructor, isMethod) {
        var methodName = null;
        if (isMethod) {
            methodName = fun;
            fun = receiver[methodName];
        } else {
            receiver = (function () { return this; })();
        }
        return this.call(receiver, fun, args, isConstructor, isMethod, methodName);
    };

    /**
     * The HTML instrumentation injects a call to this function after
     * every element that gets declared statically in the HTML.
     * This function simply delegates the call to each of the listeners.
     */
    this.onDeclareElement = function (elementId) {
        var element = document.getElementById(elementId);
        if (!self.disabled && !self.analysisFinished) {
            if (element !== null) {
                if (element.dataset.isDeclared === 'true') {
                    // Already declared...
                } else {
                    var intermediate = eventStack.onEnterElementDeclaration(element);
                    try {
                        notifyListeners('onDeclareElement', [element]);
                        element.dataset.isDeclared = 'true';
                    } finally {
                        eventStack.onExitElementDeclaration(intermediate);
                    }
                }
            }
        }
        
        var script = document.getElementById('script-' + elementId);
        if (script) {
            script.remove();
        }
    };

    /**
     * The following function is invoked by the HTML instrumentation,
     * whenever it seems like jQuery might have been loaded.
     *
     * This function checks if jQuery has in fact been loaded. In that case,
     * it replaces jQuery's `on` function, with a function that invokes
     * `onRegisterEventHandler` targets, and then calls the original
     * jQuery `on` function.
     */
    var jQueryIntercepted = false;
    this.jQueryLoaded = function () {
        if (jQueryIntercepted) {
            return;
        }

        // Check if jQuery appears to be loaded
        if (window.jQuery) {
            var _on = window.jQuery.fn.on;

            // Replace jQuerys `on` function
            window.jQuery.fn.on = function (events, selector, data, handler) {
                var types = events.split(' ');
                for (var i = 0; i < types.length; ++i) {
                    var type = types[i];
                    if (utils.eventHandlerAttributeNames.indexOf('on' + type) >= 0) {
                        var targets = this;
                        if (typeof selector === 'string') {
                            // Use jQuery to evaluate the selector
                            targets = window.jQuery(selector, this);
                        }
                        // For each target, invoke `onRegisterEventHandler` on all listeners
                        for (var j = 0; j < targets.length; ++j) {
                            var base = targets[j];
                            notifyListeners('onRegisterEventHandler',
                                [base, type, null, null, { kind: '$.on' }]);
                        }
                    }
                }

                // Call the original jQuery `on` function
                ++self.disabled;
                var result = _on.apply(this, arguments);
                --self.disabled;

                return result;
            };
            jQueryIntercepted = true;
        }
    };
}

// Instrument natives.XMLHttpRequest.prototype.open such that the URL is kept for later
XMLHttpRequest.prototype.open = function (method, url, isAsync, user, password) {
    var shadow = shadowing.getShadow(this);
    shadow.isAsync = !!isAsync;
    shadow.url = url;
    return natives.refs.XMLHttpRequest.open.apply(this, arguments);
};

module.exports = function () {
    natives.disableUndesirableSideEffects();

    if (argv.mode !== 'screenshot') {
        // Race detectors
        var AccessBeforeDefinitionRaceDetector = require('./analyses/access-before-definition-race-detector.js');
        var LateEventHandlerRegistrationRaceDetector = require('./analyses/late-event-handler-registration-race-detector.js');
        var FormInputOverwrittenRaceDetector = require('./analyses/form-input-race-detector.js');

        // Misc.
        var Stats = require('./analyses/stats.js');

        // Create an InitRacer instance
        var initRacer = window.initRacer = window.$ir = new InitRacer();
        
        var info = initRacer.info = new Stats(initRacer, _$);
        initRacer.addListener(info);

        // Observation execution mode
        if (argv.mode === 'observation') {
            // Late-event-handler-registration
            var lateEventHandlerRegistrationRaceDetector =
                initRacer.lateEventHandlerRegistrationRaceDetector =
                    new LateEventHandlerRegistrationRaceDetector(initRacer, _$);
            initRacer.addListener(lateEventHandlerRegistrationRaceDetector);

            // Form-input-overwritten
            var formInputOverwrittenRaceDetector =
                initRacer.formInputOverwrittenRaceDetector =
                    new FormInputOverwrittenRaceDetector(initRacer, _$);
            initRacer.addListener(formInputOverwrittenRaceDetector);

            initRacer.getReport = function (name) {
                return {
                    name: name,
                    accessBeforeDefinitionRaces: [],
                    lateEventHandlerRegistrationRaces: lateEventHandlerRegistrationRaceDetector.getReport(),
                    formInputOverwrittenRaces: formInputOverwrittenRaceDetector.getReport(),
                    info: info.getReport()
                };
            };

            initRacer.getSummary = function (name) {
                return {
                    name: name,
                    accessBeforeDefinitionRaces: {},
                    lateEventHandlerRegistrationRaces: lateEventHandlerRegistrationRaceDetector.getSummary(),
                    formInputOverwrittenRaces: formInputOverwrittenRaceDetector.getSummary(),
                    info: info.getSummary()
                };
            };
        }

        // Adverse execution mode
        if (argv.mode === 'adverse' || argv.mode === 'validation') {
            // Access-before-definition
            var accessBeforeDefinitionRaceDetector =
                initRacer.accessBeforeDefinitionRaceDetector =
                    new AccessBeforeDefinitionRaceDetector(initRacer, _$);
            initRacer.addListener(accessBeforeDefinitionRaceDetector);
        }
    } else {
        var initRacer = window.initRacer = window.$ir = require('./ui/tooltips.js');
        initRacer.initializeOpentip(initRacer._$ = _$);
    }
};
