var charfunk = require('charfunk');
var falafel = require('falafel');
var util = require('util');

function deinstrumentJavaScript(code) {
    function transform(node, update) {
        if (node.type === 'SequenceExpression') {
            update('(' + node.source() + ')'); // Not added by falafel?!
        }

        if (node.type !== 'CallExpression' ||
                node.callee.type !== 'MemberExpression' ||
                node.callee.object.type !== 'Identifier' ||
                node.callee.object.name !== '$ir') {
            return;
        }

        switch (node.callee.property.name) {
            case 'assign':
                var object = node.arguments[0];
                var property = node.arguments[1];
                var value = node.arguments[2];
                if (property.type === 'Literal' && typeof property.value === 'string' && charfunk.isValidName(property.value)) {
                    // Not computed
                    update(util.format('%s.%s = %s', object.source(), property.value,
                        value.source()));
                } else {
                    // Computed
                    update(util.format('%s[%s] = %s', object.source(), property.source(),
                        value.source()));
                }
                break;

            case '_call':
                var receiver = node.arguments[0];
                var fun = node.arguments[1];
                var args = node.arguments[2];
                var isConstructor = node.arguments[3];
                var isMethod = node.arguments[4];
                if (isMethod.value) {
                    if (fun.type === 'Literal' && typeof fun.value === 'string' && charfunk.isValidName(fun.value)) {
                        update(util.format('%s%s.%s(%s)',
                            isConstructor.value ? 'new ' : '', receiver.source(), fun.value,
                            args.elements.map(function (element) {
                                return element.source();
                            }).join(', ')));
                    } else {
                        update(util.format('%s%s[%s](%s)',
                            isConstructor.value ? 'new ' : '', receiver.source(), fun.source(),
                            args.elements.map(function (element) {
                                return element.source();
                            }).join(', ')));
                    }
                } else {
                    update(util.format('%s%s(%s)',
                        isConstructor.value ? 'new ' : '', fun.source(),
                        args.elements.map(function (element) {
                            return element.source();
                        }).join(', ')));
                }
                break;

            case 'registerEvaluator':
                var fun = node.arguments[0];
                update(fun.source());
                break;
        }
    }

    try {
        return falafel({
            source: code
        }, transform).toString().trim();
    } catch (e) {
        return code;
    }
}

module.exports = deinstrumentJavaScript;
