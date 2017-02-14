var natives = require('./natives.js');
var shadowing = require('./shadowing.js');

// The initial event stack
var currentEvent = null;
var stack = [];
var history = [];

function getCurrentEvent() {
    return currentEvent;
}

function getCurrentStack() {
    return stack;
}

function getHistory() {
    return history;
}

function onExitCurrentEvent(f) {
    if (!currentEvent.exitHandlers) {
        currentEvent.exitHandlers = [];
    }
    currentEvent.exitHandlers.push(f);
}

var stackAtLastSynchronousScript = stack;

/**
 * Pushes event `e` to the current stack.
 */
function push(desc) {
    if (currentEvent !== null) {
        console.warn('Appears already to be in an event, new:', desc, 'old:', currentEvent);
        return false;
    }

    stack.push(desc);
    history.push(desc);

    currentEvent = desc;

    return true;
}

function pop() {
    if (!currentEvent) {
        console.warn('Does not appear to be in an event');
        debugger;
    } else if (currentEvent.exitHandlers) {
        currentEvent.exitHandlers.forEach((f) => f());
        delete currentEvent.exitHandlers;
    }
    
    stack.pop();
    currentEvent = null;
}

function setStack(newStack) {
    if (!newStack) {
        debugger;
    }
    stack = newStack;
}

function onEnterAjaxEvent(xhr) {
    var oldStack = stack;

    // Set the event stack to the event stack from
    // the time the Ajax request was initially sent
    var shadow = shadowing.getShadow(xhr);
    
    var isAsync = currentEvent === null && shadow.isAsync && !shadow.aborted && xhr.readyState !== natives.refs.XMLHttpRequest.OPENED;
    if (isAsync) {
        setStack(shadow.stackAtLastRequest);

        // Push a new event to the stack
        push({
            kind: "ajax",
            readyState: xhr.readyState,
            url: shadowing.getShadow(xhr).url || null,
            isLongDelay: xhr.readyState === natives.refs.XMLHttpRequest.DONE
        });
    }

    return { isAsync: isAsync, oldStack: oldStack };
}

function onExitAjaxEvent(options) {
    if (options.isAsync) {
        pop();
    }
    setStack(options.oldStack);
}

function onRegisterEventHandler(base, type, listener, useCapture) {
    // will be passed to `onEnterEventHandler`
    var isAfterParsing =
        (base === document && type === 'DOMContentLoaded') ||
        (base === window && type === 'load');
    
    var registrationStack = null;
    if (!isAfterParsing) {
        registrationStack = stack.slice();
    }

    return {
        getRegistrationStack: function () {
            return isAfterParsing ? stackAtLastSynchronousScript.slice() : registrationStack;
        }
    };
}

function onEnterEventHandler(eventObject, options) {
    var oldStack = stack;

    var isAsync = currentEvent === null;
    if (isAsync && typeof eventObject.isTrusted === 'boolean') {
        if (!eventObject.isTrusted) {
            isAsync = false;
        } else if ((eventObject.type === 'focus' || eventObject.type === 'blur') &&
                currentEvent !== null) {
            isAsync = false;
        }
    }

    if (isAsync) {
        setStack(options.getRegistrationStack());

        // Push a new event to the stack
        push({
            kind: 'event',
            eventObject: eventObject,
            isLongDelay: false // TODO: if it is a 'load' event, ...
        });
    }

    return {
        isAsync: isAsync,
        oldStack: oldStack
    };
}

function onExitEventHandler(options) {
    if (options.isAsync) {
        pop();
    }
    setStack(options.oldStack);
}

function onEnterScript(url, isExternal, isAsync) {
    if (currentEvent !== null) {
        // Already inside an event
        return { alreadyInEvent: true };
    }

    var oldStack = stack;

    // If this is a synchronous script, then it is forced to execute
    // after every other synchronous script
    var isSync = !isExternal || isExternal && !isAsync;
    if (isSync) {
        setStack(stackAtLastSynchronousScript);
    }

    push({
        kind: "script",
        isExternal: isExternal,
        isAsync: isAsync,
        url: url,
        isLongDelay: isExternal
    });

    if (isSync) {
        stackAtLastSynchronousScript = stack.slice();
    }

    return { alreadyInEvent: false, oldStack: oldStack };
}

function onExitScript(options) {
    if (!options.alreadyInEvent) {
        pop();
        setStack(options.oldStack);
    }
}

function onEnterElementDeclaration(element) {
    var oldStack = stack;

    var desc = {
        kind: 'start-HTML-tag',
        tag: element.tagName.toLowerCase(),
        id: element.id,
        location: {
            line: parseInt(element.dataset.line),
            col: parseInt(element.dataset.col)
        },
        isVisible: {
            jQuery: initRacer._$(element).is(':visible') &&
                    initRacer._$(element).css('visibility') !== 'hidden' &&
                    initRacer._$(element).css('opacity') !== '0',
            visibilityjs: element.isVisible()
        }
    };
    stackAtLastSynchronousScript.push(desc);
    history.push(desc);

    setStack(stackAtLastSynchronousScript);

    // will be passed to `onExitElementDeclaration
    return oldStack;
}

function onExitElementDeclaration(oldStack) {
    setStack(oldStack);
}

function onRegisterTimeout(x, delay) {
    // will be passed to `onEnterTimeout`
    return {
        registrationStack: stack.slice(), 
        delay: delay
    };
}

function onEnterTimeout(options) {
    var oldStack = stack;

    setStack(options.registrationStack);
    push({
        kind: 'timeout',
        delay: options.delay,
        isLongDelay: options.delay >= 500
    });

    return oldStack;
}

function onExitTimeout(oldStack) {
    pop();
    setStack(oldStack);
}

function onRegisterPromiseCallback(f, isThen, isCatch) {
    // will be passed to `onEnterPromiseCallback`
    return {
        registrationStack: stack.slice()
    };
}

function onEnterPromiseCallback(options) {
    var oldCurrentEvent = currentEvent;
    var oldStack = stack;

    var isAsync = true;
    currentEvent = null;

    if (isAsync) {
        setStack(options.registrationStack);
        push({
            kind: 'promise-callback',
            isLongDelay: false
        });
    }

    return { isAsync: isAsync, oldCurrentEvent: oldCurrentEvent, oldStack: oldStack };
}

function onExitPromiseCallback(options) {
    if (options.isAsync) {
        pop();
    }
    currentEvent = options.oldCurrentEvent;
    setStack(options.oldStack);
}

function isElementDeclaredLongTimeAgo(element, inHistory) {
    var line = parseInt(element.dataset.line);
    var col = parseInt(element.dataset.col);

    var list = inHistory ? history : stack;

    if (list) {
        var i = 0;

        // Find the declaration of `element` in the current event stack
        for (; i < list.length; ++i) {
            var desc = list[i];
            if (desc.kind === 'start-HTML-tag' &&
                    desc.id === element.id &&
                    desc.location.line === line &&
                    desc.location.col === col) {
                break;
            }
        }

        // Look if there are any long delays afterwards
        for (; i < list.length; ++i) {
            if (list[i].isLongDelay) {
                return true;
            }
        }
    }

    return false;
}

// Instrument XMLHttpRequest.prototype.send to copy the event stack
// at the time an Ajax request is sent.
var _send = natives.refs.XMLHttpRequest.send;
XMLHttpRequest.prototype.send = function () {
    var shadow = shadowing.getShadow(this);
    shadow.aborted = false;
    shadow.stackAtLastRequest = stack.slice();
    return _send.apply(this, arguments);
};

// Instrument XMLHttpRequest.prototype.abort to set the
// abort flag on the shadow.
var _abort = natives.refs.XMLHttpRequest.abort;
XMLHttpRequest.prototype.abort = function () {
    var shadow = shadowing.getShadow(this);
    shadow.aborted = true;
    return _abort.apply(this, arguments);
};

module.exports = {
    // Callbacks
    onExitCurrentEvent: onExitCurrentEvent,

    // Elements in the DOM
    onEnterElementDeclaration: onEnterElementDeclaration,
    onExitElementDeclaration: onExitElementDeclaration,

    // Ajax
    onEnterAjaxEvent: onEnterAjaxEvent,
    onExitAjaxEvent: onExitAjaxEvent,

    // Inline and external scripts
    onEnterScript: onEnterScript,
    onExitScript: onExitScript,

    // Event handlers
    onRegisterEventHandler: onRegisterEventHandler,
    onEnterEventHandler: onEnterEventHandler,
    onExitEventHandler: onExitEventHandler,

    // Timeouts
    onRegisterTimeout: onRegisterTimeout,
    onEnterTimeout: onEnterTimeout,
    onExitTimeout: onExitTimeout,

    // Promises
    onRegisterPromiseCallback:onRegisterPromiseCallback,
    onEnterPromiseCallback:onEnterPromiseCallback,
    onExitPromiseCallback:onExitPromiseCallback,

    // Misc
    getCurrentEvent: getCurrentEvent,
    getCurrentStack: getCurrentStack,
    getHistory: getHistory,
    isElementDeclaredLongTimeAgo: isElementDeclaredLongTimeAgo
};