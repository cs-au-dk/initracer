var parse5 = require('parse5');
var treeAdapter = parse5.treeAdapters.default;

function getAttribute(node, name) {
	var attrs = node.attrs || [];
    for (i = 0; i < attrs.length; ++i) {
        var attr = attrs[i];
        if (attr.name === name) {
            return attr;
        }
    }
    return null;
}

function insertAfter(node, newNode) {
    var nodeIdx = node.parentNode.childNodes.indexOf(node);
    if (nodeIdx+1 === node.parentNode.childNodes.length) {
        treeAdapter.appendChild(node.parentNode, newNode);
    } else {
        treeAdapter.insertBefore(node.parentNode, newNode, node.parentNode.childNodes[nodeIdx+1]);
    }
}

module.exports = {
	getAttribute: getAttribute,
    insertAfter: insertAfter
};
