var natives = require('./natives.js');

/**
 * Given event target and event type returns an event object,
 * or null, if the type is not supported.
 */
function factory(target, type) {
    var htmlElement = document.querySelector('html');
    var bodyElement = document.querySelector('body');

    var path = [target, document, window];

    switch (type) {
        case 'abort':
        case 'error':
            if (target instanceof natives.refs.Element.ref && target.tagName.toLowerCase() === 'img') {
                var eventObject = new Event(type, {
                    bubbles: type === 'abort', cancelable: false
                });
                Object.defineProperties(eventObject, {
                    currentTarget: target,
                    path: { value: path, writable: true },
                    srcElement: { value: target, writable: true },
                    target: { value: target, writable: true }
                });
                return eventObject;
            }
            break;

        case 'blur':
        case 'focus':
            var eventObject = new FocusEvent(type, {
                bubbles: false, cancelable: false, composed: true,
                sourceCapabilities: new InputDeviceCapabilities(), view: window
            });
            Object.defineProperties(eventObject, {
                path: { value: path, writable: true },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true }
            });
            return eventObject;

        case 'change':
        case 'input':
            if (target instanceof natives.refs.Element.ref) {
                var eventObject = null;
                if (target.tagName.toLowerCase() === 'input') {
                    eventObject = new Event(type, {
                        bubbles: true, cancelable: false
                    });
                    Object.defineProperties(eventObject, {
                        currentTarget: target,
                        path: { value: path, writable: true },
                        srcElement: { value: target, writable: true },
                        target: { value: target, writable: true }
                    });
                } else if (target.tagName.toLowerCase() === 'select' && type === 'change') {
                    eventObject = new Event(type, {
                        bubbles: true, cancelable: false
                    });
                    Object.defineProperties(eventObject, {
                        currentTarget: target,
                        path: { value: path, writable: true },
                        srcElement: { value: target, writable: true },
                        target: { value: target, writable: true }
                    });
                }
                return eventObject;
            }
            break;

        case 'click':
        case 'dblclick':
            if (!(target instanceof natives.refs.Element.ref)) {
                // When the user is issuing a click on the screen,
                // then the <html> element is the target.
                target = htmlElement;
                path = [htmlElement, document, window];
            }

            var eventObject = new MouseEvent(type, {
                bubbles: true, cancelable: true, composed: true, view: window
            });
            Object.defineProperties(eventObject, {
                path: { value: path, writable: true },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true },
                toElement: { value: target, writable: true }
            });
            return eventObject;

        case 'drag':
            if (!(target instanceof natives.refs.Element.ref)) {
                // When the user is issuing a drag on the screen,
                // then the <body> element is the target.
                if (bodyElement) {
                    target = bodyElement;
                    path = [bodyElement, htmlElement, document, window];
                } else {
                    return null;
                }
            }

            var eventObject = new DragEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                // dataTransfer: { dropEffect: 'none', effectAllowed: 'uninitialized' },
                sourceCapabilities: new InputDeviceCapabilities(), view: window
            });
            Object.defineProperties(eventObject, {
                path: { value: path, writable: true },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true },
                toElement: { value: target, writable: true }
            });
            return eventObject;

        case 'hashchange':
            var eventObject = new HashChangeEvent(type, {
                bubbles: false, cancelable: false,
                newURL: document.location.href, oldURL: document.location.href
            });
            Object.defineProperties(eventObject, {
                currentElement: { value: window, writable: true },
                path: { value: [window], writable: true },
                srcElement: { value: window, writable: true },
                target: { value: window, writable: true }
            });
            return eventObject;

        case 'keydown':
        case 'keypress':
        case 'keyup':
            if (!(target instanceof natives.refs.Element.ref)) {
                if (bodyElement) {
                    target = bodyElement;
                    path = [bodyElement, htmlElement, document, window];
                } else {
                    return null;
                }
            }

            var eventObject = new KeyboardEvent(type, { 
                bubbles: true, cancelable: true, charCode: 0, code: 'KeyA', composed: true,
                key: 'a', sourceCapabilities: new InputDeviceCapabilities(), view: window
            });
            Object.defineProperties(eventObject, {
                keyCode: { value: 65, writable: true },
                path: { value: path, writable: true },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true },
                which: { value: 65, writable: true }
            });
            return eventObject;

        case 'load':
            if (target instanceof natives.refs.Element.ref) {
                var tagName = target.tagName.toLowerCase();
                if (tagName === 'iframe' || tagName === 'img') {
                    var eventObject = new Event(type, {
                        bubbles: false, cancelable: false
                    });
                    Object.defineProperties(eventObject, {
                        currentTarget: target,
                        path: { value: path, writable: true },
                        srcElement: { value: target, writable: true },
                        target: { value: target, writable: true }
                    });
                    return eventObject;
                }
            }
            break;

        case 'contextmenu':
        case 'mousemove':
        case 'mouseover':
        case 'mouseout':
            if (!(target instanceof natives.refs.Element.ref)) {
                // When the user is issuing a click on the screen,
                // then the <html> element is the target.
                target = htmlElement;
                path = [htmlElement, document, window];
            }

            var eventObject = new MouseEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                sourceCapabilities: new InputDeviceCapabilities(), view: window
            });
            Object.defineProperties(eventObject, {
                path: { value: path, writable: true },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true },
                toElement: { value: target, writable: true }
            });
            return eventObject;

        case 'mousedown':
        case 'mouseup':
            if (!(target instanceof natives.refs.Element.ref)) {
                // When the user is issuing a click on the screen,
                // then the <html> element is the target.
                target = htmlElement;
                path = [htmlElement, document, window];
            }

            var eventObject = new MouseEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                sourceCapabilities: new InputDeviceCapabilities(), view: window
            });
            Object.defineProperties(eventObject, {
                path: { value: path, writable: true },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true },
                toElement: { value: target, writable: true }
            });
            return eventObject;

        case 'pagehide':
        case 'pageshow':
            var eventObject = new PageTransitionEvent(type, {
                bubbles: true, cancelable: true
            });
            return eventObject;

        case 'reset':
            if (target instanceof natives.refs.Element.ref && target.tagName.toLowerCase() === 'form') {
                var eventObject = new Event(type, {
                    bubbles: true, cancelable: true
                });
                Object.defineProperties(eventObject, {
                    currentTarget: target,
                    path: { value: path, writable: true },
                    srcElement: { value: target, writable: true },
                    target: { value: target, writable: true }
                });
                return eventObject;
            }
            break;

        case 'resize':
            var eventObject = new Event(type, {
                bubbles: false, cancelable: false
            });
            Object.defineProperties(eventObject, {
                currentTarget: window,
                path: { value: [window], writable: true },
                srcElement: { value: window, writable: true },
                target: { value: window, writable: true }
            });
            return eventObject;

        case 'scroll':
            var eventObject = new Event(type, {
                bubbles: true, cancelable: false
            });
            Object.defineProperties(eventObject, {
                path: {
                    value: target instanceof natives.refs.Element.ref
                        ? [target, document, window]
                        : [document, window]
                },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true }
            });
            return eventObject;

        case 'submit':
            var eventObject = new Event(type, {
                bubbles: true, cancelable: true
            });
            Object.defineProperties(eventObject, {
                path: {
                    value: target instanceof natives.refs.Element.ref
                        ? [target, document, window]
                        : [document, window]
                },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true }
            });
            return eventObject;

        case 'touchstart':
            if (!(target instanceof natives.refs.Element.ref)) {
                // When the user is issuing a click on the screen,
                // then the <html> element is the target.
                target = htmlElement;
                path = [htmlElement, document, window];
            }

            var touches = null;
            if (document.body) {
                touches = [
                    new Touch({ identifier: 0, target: document.body })
                ];
            }

            var eventObject = new TouchEvent(type, {
                bubbles: true, cancelable: true, view: window
            });
            Object.defineProperties(eventObject, {
                path: { value: path, writable: true },
                srcElement: { value: target, writable: true },
                target: { value: target, writable: true },
                touches: { value: touches, writable: true }
            });
            return eventObject;
    }
    return null;
}

module.exports = factory;