var natives = require('./natives.js');

var eventHandlerAttributeNames = ['onabort', 'onafterprint', 'onbeforeprint',
    'onbeforeunload', 'onblur', 'onchange', 'onclick', 'oncontextmenu',
    'oncopy', 'oncut', 'ondblclick', 'ondrag', 'ondragend', 'ondragenter',
    'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'onerror',
    'onfocus', 'onhashchange', 'oninput', 'oninvalid', 'onkeydown', 'onkeypress',
    'onkeyup', 'onload', 'onmessage', 'onmousedown', 'onmouseenter',
    'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover',
    'onmouseup', 'onmousewheel', 'onoffline', 'ononline', 'onpagehide',
    'onpageshow', 'onpaste', 'onpopstate', 'onreadystatechange', 'onreset',
    'onresize', 'onscroll', 'onsearch', 'onselect', 'onshow', 'onstorage',
    'onsubmit', 'ontoggle', 'ontouchstart', 'onunload', 'onwheel'];

var userEventNames = [
    'blur', 'change', 'click', 'contextmenu', 'copy', 'cut', 'dblclick',
    'drag', 'dragend', 'dragenter', 'dragleave', 'dragover', 'dragstart',
    'drop', 'focus', 'input', 'keydown', 'keypress', 'keyup', 'mousedown',
    'mouseenter', 'mouseleave', 'mousemove', 'mouseout', 'mouseover',
    'mouseup', 'mousewheel', 'pagehide', 'pageshow', 'paste', 'reset',
    'resize', 'scroll', 'search', 'select', 'show', 'submit', 'toggle',
    'touchstart', 'wheel'];

/**
 * Takes a string `url` as input, and returns an extension of URL.
 *
 * Example:
 * augmentUrl('http://foo.com', { name: 'val' }) = 'http://foo.com?name=val'.
 */
function augmentUrl(url, params) {
    var hash = '';
    var hashIdx = url.indexOf('#');
    if (hashIdx >= 0) {
        hash = url.substring(hashIdx);
        url = url.substring(0, hashIdx);
    }
    var query = [];
    (params instanceof Array ? params : [params]).forEach(function (param) {
        if (url.indexOf(param.name + '=') < 0) {
            query.push(param.name + '=' + param.value);
        }
    });
    if (!query.length) return url;
    query = query.join('&');
    if (url.indexOf('?') >= 0) {
        url += '&' + query + hash;
    } else {
        url += '?' + query + hash;
    }
    return url;
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getTargetName(target) {
    if (target instanceof natives.refs.Element.ref) {
        return target.tagName.toLowerCase();
    }
    if (target === document) {
        return 'document';
    }
    if (target === window) {
        return 'window';
    }
    if (target instanceof natives.refs.XMLHttpRequest.ref) {
        return 'XMLHttpRequest';
    }

    console.error('Unexpected target in getTargetName()');
    debugger;
    return null;
}

function stackTrace() {
    return new Error().stack.split('\n');
}

module.exports = {
    augmentUrl: augmentUrl,
    eventHandlerAttributeNames: eventHandlerAttributeNames,
    getRandomInt: getRandomInt,
    getTargetName: getTargetName,
    stackTrace: stackTrace,
    userEventNames: userEventNames
};
