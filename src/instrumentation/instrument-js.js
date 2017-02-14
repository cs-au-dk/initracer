// External
var acorn = require('acorn');
var esotope = require('esotope');
var jsesc = require('jsesc');
var falafel = require('falafel');
var util = require('util');

// Internal
var utils = require('../utils/utils.js');

/**
 * This function takes a piece of JavaScript (`input`), and instruments it.
 * The instrumentation:
 * - inserts calls to `enterScript()` and `exitScript()`
 *   in inline JavaScripts, and
 * - inserts calls to `enterScript()` and `exitScript()`
 *   in external JavaScript files (i.e., *.js files).
 *
 * It additionally instruments (selected) property assignments.
 *
 * The options are as follows:
 * - `options.isExternal`: true if `input` originates from a *.js file,
 * - `options.allowReturnOutsideFunction`: true if `input` originates from an
 *   inline event handler registration in the HTML,
 * - `options.url`: the URL of the source being instrumented.
 */
function instrumentJavaScript(input, options) {
    // Instrument the property assignments in `input`
    var instrumented = instrumentSelectedPropertyRW(input, {
        allowReturnOutsideFunction: options.allowReturnOutsideFunction
    });

    if (options.isExternal || !options.allowReturnOutsideFunction) {
        // Insert calls to `onEnterScript()` and `onExitScript()`
        var async = false;
        if (options.isExternal) {
            if (options.url.indexOf('sync=0') >= 0) {
                async = true;
            } else if (options.url.indexOf('sync=1') < 0) {
                async = null; // unknown
            }
        }

        var rnd = utils.getRandomInt(1000000000, 9999999999); // random 10 digit number
        instrumented = util.format(
            'var intermediate%s = window.$es && window.$es.onEnterScript(%s, %s, %s);\n' +
            'try {\n%s\n} ' +
            'finally { window.$es && window.$es.onExitScript(intermediate%s); }',
            rnd, JSON.stringify(options.url), options.isExternal, async, instrumented, rnd);
    }

    return instrumented;
}

var ExpressionType = {
    AssignmentExpression: 'AssignmentExpression',
    CallExpression: 'CallExpression',
    FunctionExpression: 'FunctionExpression',
    Literal: 'Literal',
    MemberExpression: 'MemberExpression',
    NewExpression: 'NewExpression'
};

var StatementType = {
    ForStatement: 'ForStatement',
    ForInStatement: 'ForInStatement',
    ForOfStatement: 'ForOfStatement',
    FunctionDeclaration: 'FunctionDeclaration',
    ReturnStatement: 'ReturnStatement',
    VariableDeclaration: 'VariableDeclaration'
};

/**
 * This function instruments selected property assignments in a piece of JavaScript (`input`).
 *
 * The transformation is a follows:
 * - e1.f = e2 => $ir.assign(e1, 'f', e2), and
 * - e1[e2] = e3 => $ir.assign(e1, e2, e3).
 *
 * Note: This function does not transform property assigments,
 * where the operator is not `=` (e.g., `+=`).
 */
function instrumentSelectedPropertyRW(input, options) {
    function transform(node, update) {
        if (node.type === ExpressionType.AssignmentExpression &&
                node.operator === '=' &&
                node.left.type === ExpressionType.MemberExpression) {
            var instrumented = instrumentWrite(node);
            if (instrumented) {
                update(instrumented);
            }
        } else if (node.type === ExpressionType.CallExpression) {
            var instrumented = instrumentCall(node);
            if (instrumented) {
                update(instrumented);
            }
        } else if (node.type === ExpressionType.NewExpression) {
            var instrumented = instrumentCall(node);
            if (instrumented) {
                update(instrumented);
            }
        } else if (node.type === ExpressionType.FunctionExpression) {
            if (node.parent.type === 'NewExpression' && node.parent.callee === node) {
                // Skip
            } else if (node.parent.type === 'Property' && (node.parent.kind === 'get' || node.parent.kind === 'set')) {
                // Skip
            } else {
                update(util.format('$ir.registerEvaluator(%s, ($ir_expr) => eval($ir_expr))',
                    node.source()));
            }
        } else if (node.type === StatementType.FunctionDeclaration) {
            update(util.format('%s\n$ir.registerEvaluator(%s, ($ir_expr) => eval($ir_expr));',
                node.source(), node.id.name));
        } else if (node.type === ExpressionType.Literal) {
            if (typeof node.value === 'string') {
                var scriptIdx = node.value.indexOf('</scr' + 'ipt>');
                if (scriptIdx >= 0) {
                    var left = node.value.substring(0, scriptIdx+4);
                    var right = node.value.substring(scriptIdx+4);

                    var quotes = node.value[0] === '\'' ? 'single' : 'double';
                    var sanitized = jsesc(left, { quotes: quotes, escapeEtago: true, wrap: true }) + '+' +
                        jsesc(right, { quotes: quotes, escapeEtago: true, wrap: true })

                    update(sanitized);
                }
            }
        } else if (node.type === 'SequenceExpression') {
            update('(' + node.source() + ')'); // Not added by falafel?!
        }

        if (node.funcDepth === 0 && node.type === StatementType.VariableDeclaration) {
            var decls = [];
            var assignments = [];
            for (var i = 0, n = node.declarations.length; i < n; ++i) {
                var decl = node.declarations[i];
                decls.push(decl.id.name + ' = (window.' + decl.id.name + ' = undefined || window.' + decl.id.name + ')');
                if (decl.init) {
                    assignments.push(decl.id.name + ' = ' + decl.init.source());
                }
            }
            result.push('var ' + decls.join(', ') + ';');
            if (assignments.length) {
                // Only add a trailing semicolon if it is not a variable declaration in a for statement
                var trailingSemicolon = node.parent.type === StatementType.ForStatement && node === node.parent.init ? '' : ';';
                update(assignments.join(', ') + trailingSemicolon);
            } else if (node.parent.type === StatementType.ForInStatement || node.parent.type === StatementType.ForOfStatement) {
                update(node.declarations[0].id.source());
            } else {
                update('');
            }
        } else if (node.funcDepth === 1 && node.type === StatementType.FunctionDeclaration) {
            result.push(node.source());
            result.push('window.' + node.id.name + ' = ' + node.id.name + ';');
            update('');
        }
    }

    try {
        var result = [];

        // The falafel library calls the `transform` function for every node in the program
        var ast = acorn.parse(input, { allowReturnOutsideFunction: true });
        var pp = esotope.generate(ast, { comment: true });
        result.push(falafel({
            allowReturnOutsideFunction: options.allowReturnOutsideFunction,
            source: pp,
            visit: function (node) {
                if (node.type === StatementType.FunctionDeclaration || node.type === ExpressionType.FunctionExpression) {
                    node.funcDepth = (node.parent.funcDepth || 0) + 1;
                } else if (node.parent) {
                    node.funcDepth = node.parent.funcDepth;
                } else {
                    node.funcDepth = 0;
                }
            }
        }, transform).toString().trim());
        return result.join('\n');
    } catch (e) {
        if (e.name === 'SyntaxError') {
            return 'throw new SyntaxError(' + jsesc(e.message, { quotes: 'single', escapeEtago: true, wrap: true }) + ');';
        }
        console.error('Failure during script instrumentation:', e.message + ' (' + e.name + ').');
        console.error('Source:', input);
        throw e;
    }
}

function instrumentCall(callExpr) {
    if (callExpr.callee.type === 'Identifier' && callExpr.callee.name === 'eval') {
        return util.format('eval(initRacer.instrument(%s))', callExpr.arguments[0].source());
    }

    var receiver = null;
    var fun = null;
    var args = (callExpr.arguments || []).map(function (arg) {
        return arg.source();
    });

    var isMethod = callExpr.callee.type === 'MemberExpression';
    var isConstructor = callExpr.type === 'NewExpression';

    if (isMethod) {
        receiver = callExpr.callee.object.source();
        fun = callExpr.callee.computed
            ? callExpr.callee.property.source()
            : jsesc(callExpr.callee.property.name, { quotes: 'single', escapeEtago: true, wrap: true });
    } else {
        fun = callExpr.callee.source();
    }

    return util.format('$ir._call(%s, %s, [%s], %s, %s)',
        receiver, fun, args.join(', '), isConstructor, isMethod);
}

function instrumentWrite(assignmentExpr) {
    var left = assignmentExpr.left;
    if (left.computed) {
        // Conservatively instrument assignments,
        // where we do not know which property is being assigned
        return util.format('$ir.assign(%s, %s, %s)',
            left.object.source(), left.property.source(), assignmentExpr.right.source());
    }

    var property = left.property.source();
    return util.format('$ir.assign(%s, \'%s\', %s)',
        left.object.source(), property, assignmentExpr.right.source());
}

module.exports = instrumentJavaScript;
