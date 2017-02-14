// External
var fs = require('fs');
var parse5 = require('parse5');
var path = require('path');
var proxy = require('rewriting-proxy');
var treeAdapter = parse5.treeAdapters.default;

// Internal
var instrumentJavaScript = require('./instrument-js.js');
var parse5utils = require('../utils/parse5.js');
var utils = require('../utils/utils.js');

var root = path.join(__dirname, '../..');

function visitNode(node, argv) {
    var newNode, i;
    var attrs = node.attrs || [];

    switch (node.tagName) {
        case 'head':
            // Insert InitRacer's JavaScript in the beginning of <head>
            var oldNode = newNode = treeAdapter.createElement('script', undefined, []);
            treeAdapter.insertText(newNode, 'window.argv = ' + JSON.stringify(argv) + ';\n');
            treeAdapter.insertText(newNode, 'if (document.location.hash.indexOf(\'mode=adverse\') >= 0) window.argv.mode = \'adverse\';\n');
            treeAdapter.insertText(newNode, 'if (document.location.hash.indexOf(\'mode=observation\') >= 0) window.argv.mode = \'observation\';\n');
            treeAdapter.insertText(newNode, fs.readFileSync(path.join(root, 'out/bundle.js')));
            treeAdapter.insertBefore(node, newNode, node.childNodes[0]);

            // Insert InitRacer's dependencies in the beginning of <head>, before InitRacer
            newNode = treeAdapter.createElement('script', undefined, []);
            treeAdapter.insertText(newNode, fs.readFileSync(path.join(root, 'third-party/jquery-2.2.3.min.js')) + '\n');
            if (argv.mode === 'screenshot') {
                treeAdapter.insertText(newNode, fs.readFileSync(path.join(root, 'third-party/opentip.min.js')) + '\n');
            } else {
                treeAdapter.insertText(newNode, fs.readFileSync(path.join(root, 'third-party/visibility.min.js')) + '\n');
            }
            treeAdapter.insertBefore(node, newNode, oldNode);

            if (argv.mode === 'screenshot') {
                oldNode = newNode;

                // Insert the css required by the tooltip library in the beginning of <head>
                newNode = treeAdapter.createElement('style', undefined, []);
                treeAdapter.insertText(newNode, fs.readFileSync(path.join(root, 'third-party/opentip.css')));
                treeAdapter.insertBefore(node, newNode, oldNode);
            }
            break;

        case 'script':
            // Extract the `src` and `async` attributes from the script-tag
            var async = false, srcAttr = parse5utils.getAttribute(node, 'src');
            for (i = attrs.length-1; i >= 0; --i) {
                var attr = attrs[i];
                var name = attr.name.toLowerCase();
                if (name === 'async') {
                    async = true;
                } else if (name === 'integrity') {
                    // Remove integrity attributes
                    attrs.splice(i, 1);
                }
            }

            if (argv.mode !== 'screenshot' && srcAttr) {
                if (async) {
                    // If the page appears to be loading jQuery, then invoke `initRacer.jQueryLoaded()`,
                    // such that InitRacer can mock `$.on` (to handle event delegation through jQuery).
                    if (srcAttr.value.indexOf('jquery') >= 0) {
                        newNode = treeAdapter.createElement('script', undefined, []);
                        treeAdapter.insertText(newNode, 'initRacer.jQueryLoaded();');
                        parse5utils.insertAfter(node, newNode);
                    }
                }

                // Augment the URL of the script, such that it is possible to recognize
                // at runtime whether a script is loaded synchronously or not
                srcAttr.value = utils.augmentUrl(srcAttr.value, { name: "sync", value: async ? 0 : 1 });
            }
            break;
    }

    if (node.tagName && node.__location) {
        var location = node.__location;

        // Add attributes `data-line` and `data-col` to the HTML element
        node.attrs.push(
            { name: 'data-line', value: location.line.toString() },
            { name: 'data-col', value: location.col.toString() }
        );

        // Retrieve the id of the HTML element (if there is none,
        // create a new unique id)
        var id, idAttr = parse5utils.getAttribute(node, 'id');
        if (idAttr && idAttr.value.trim().length) {
            id = idAttr.value;
        } else if (idAttr) {
            id = idAttr.value = node.tagName.toLowerCase() + '_l' + location.line + '_c' + location.col;
        } else {
            attrs.push({ name: 'id', value: id = node.tagName.toLowerCase() + '_l' + location.line + '_c' + location.col });
        }

        if (argv.mode !== 'screenshot') {
            // Invoke `initRacer.onDeclareElement()`
            newNode = treeAdapter.createElement('script', undefined, [{
                name: 'id',
                value: 'script-' + id
            }]);
            treeAdapter.insertText(newNode, 'initRacer.onDeclareElement(\'' + id + '\');');
            parse5utils.insertAfter(node, newNode);
        }
    }
}

module.exports = function (input) {
    var argv = { mode: process.env.INITRACER_MODE };
    if (typeof process.env.INITRACER_INJECTION_SPEC !== 'undefined') {
        argv.injectionSpec = JSON.parse(process.env.INITRACER_INJECTION_SPEC);
    }
    if (typeof process.env.INITRACER_TOOLTIP_SPEC !== 'undefined') {
        argv.tooltipDescriptors = JSON.parse(process.env.INITRACER_TOOLTIP_SPEC);
    }
    var inlineRewriter = function (code, metadata) {
        if (argv.mode !== 'screenshot') {
            try {
                return instrumentJavaScript(code, {
                    allowReturnOutsideFunction: metadata.type === 'event-handler' || metadata.type === 'javascript-url',
                    isExternal: false,
                    url: metadata.url // e.g., http://foo.com/#inline-1
                });
            } catch (e) {
                // Do not crash in case of syntax errors
            }
        }
        return code;
    };
    return proxy.rewriteHTML(input, process.env.INITRACER_URL, inlineRewriter, null, null, {
        onNodeVisited: function (node) { visitNode(node, argv) },
        locationInfo: true
    });
};
