if (typeof window === 'undefined') {
    return;
}

var refs = {
    eval: window.eval,
    setTimeout: window.setTimeout,
    location: {
        assign: window.location.assign,
        reload: window.location.reload,
        replace: window.location.replace
    },
    Element: {
        addEventListener: window.Element.prototype.addEventListener,
        removeEventListener: window.Element.prototype.removeEventListener,
        ref: window.Element
    },
    Function: {
        apply: window.Function.prototype.apply,
        call: window.Function.prototype.call,
        ref: window.Function
    },
    HTMLElement: {
        focus: window.HTMLElement.prototype.focus
    },
    Map: {
        ref: window.Map
    },
    MessagePort: {
        ref: window.MessagePort
    },
    Promise: {
        then: window.Promise.prototype.then,
        ref: window.Promise
    },
    Set: {
        ref: window.Set
    },
    XMLHttpRequest: {
        abort: window.XMLHttpRequest.prototype.abort,
        open: window.XMLHttpRequest.prototype.open,
        send: window.XMLHttpRequest.prototype.send,
        ref: window.XMLHttpRequest,
        DONE: window.XMLHttpRequest.DONE,
        OPENED: window.XMLHttpRequest.OPENED
    }
};

function disableUndesirableSideEffects() {
    HTMLFormElement.prototype.submit = function () {
        console.warn('form.submit() called');
        // do not submit forms during analysis
    };

    HTMLElement.prototype.click = function () {
        console.warn('element.click() called');
        // do not follow links during analysis
    };

    window.alert = function () {
        console.warn('window.alert() called');
        return null; // do not open alerts during analysis
    };

    window.confirm = function () {
        console.warn('window.confirm() called');
        return true;
    };

    window.open = function () {
        console.warn('window.open() called');
        return null; // do not open windows during analysis
    };

    window.print = function () {
        console.warn('window.print() called');
        return null; // do not open print dialog during analysis
    };

    History.prototype.back = function () {
        console.warn('history.back() called');
    };

    History.prototype.forward = function () {
        console.warn('history.forward() called');
    };

    History.prototype.go = function () {
        console.warn('history.go() called');
    };

    History.prototype.pushState = function () {
        console.warn('history.pushState() called');
    };

    History.prototype.replaceState = function () {
        console.warn('history.replaceState() called');
    };
}

module.exports = {
    disableUndesirableSideEffects: disableUndesirableSideEffects,
    refs: refs
};
