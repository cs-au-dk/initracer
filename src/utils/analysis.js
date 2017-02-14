// External
var acorn = require('acorn');
var walk = require('acorn/dist/walk.js');
var esotope = require('esotope');

// Internal
var bindings = require('./bindings.js');
var deinstrumentJavaScript = require('../instrumentation/deinstrument-js.js');
var natives = require('./natives.js');

function buildAst(f, code) {
    if (!code) {
        code = extractCode(f);
    }
    try {
        return acorn.parse(code, {
            allowReturnOutsideFunction: true
        });
    } catch (e) {
        // Could not parse code coming from a real function.
        // It may be a native function, or due to an internal
        // error in the acorn parser.
        if (code.indexOf('{ [native code] }') < 0) {
            console.error('Unexpected: acorn failed to parse syntactically correct function', f, code);
        }
        return null;
    }
}

function accessToString(access) {
    if (typeof access.source !== 'string') {
        console.error('Unexpected');
        debugger;
        return '???';
    }
    return access.source;
}

/**
 * Evaluates an access path in the current state, and invokes
 * the callback function `cb` with two arguments `err` (whether
 * evaluating the expression gives an error) and `val` (the result
 * of the evaluation if no failure was encountered).
 */
function evaluateAccessPath(accessPath, evaluator, cb) {
    if (accessPath.length === 0) {
        throw new Error('Unexpected');
    }

    var result;
    try {
        result = evaluator(accessPath[0]);
    } catch (e) {
        return cb(e, null);
    }
    for (var i = 1; i < accessPath.length; ++i) {
        if (result) {
            result = result[accessPath[i]];
        } else {
            return cb(new TypeError('Cannot read property \'' + accessPath[i] + '\' of ' + result));
        }
    }
    return cb(null, result);
}

/**
 * Extracts the syntactic construct from `code` that may lead to
 * exceptions (e.g., `f()` is a TypeError if `f` is not a function,
 * and `o.p` is a TypeError if `o` is not defined).
 */
function extractAccessesInAst(ast) {
    var accesses = [];
    var assignments = [];
    var locals = ['arguments'];
    try {
        walk.ancestor(ast, {
            AssignmentExpression: function (node, st, ancestors) {
                var left = node.left;
                if (left.type === 'Identifier') {
                    var assignment = {
                        kind: 'variable',
                        name: left.name,
                        source: left.name
                    };
                    assignments.push(assignment);
                } else if (left.type === 'MemberExpression' && !left.computed) {
                    getAccessPath(left.object, function (prefixPath) {
                        var assignment = {
                            kind: 'member',
                            object: prefixPath,
                            property: left.property.name,
                            source: prefixPath.join('.') + '.' + left.property.name
                        };
                        assignments.push(assignment);
                    });
                }
            },
            CallExpression: function (node, st, ancestors) {
                getAccessPath(node.callee, function (calleePath) {
                    var access = {
                        kind: 'call',
                        callee: calleePath,
                        source: calleePath.join('.') + '()'
                    };

                    var prefixes = [];
                    for (var i = 0; i < access.callee.length-1; ++i) {
                        var name = access.callee[i];
                        if (prefixes.length) {
                            prefixes.push(prefixes[prefixes.length-1] + '.' + name);
                        } else {
                            prefixes.push(name);
                        }
                    }

                    accesses.push(access);
                });
            },
            CatchClause: function (node, st, ancestors) {
                locals.push(node.param.name);
            },
            FunctionDeclaration: function (node, st, ancestors) {
                locals.push(node.id.name);
                for (var i = 0; i < node.params.length; ++i) {
                    locals.push(node.params[i].name);
                }
            },
            FunctionExpression: function (node, st, ancestors) {
                for (var i = 0; i < node.params.length; ++i) {
                    locals.push(node.params[i].name);
                }
            },
            Identifier: function (node, st, ancestors) {
                var parent = ancestors[ancestors.length - 2];
                if (parent.type === 'UnaryExpression' || parent.operator === 'typeof') {
                    // Does not give a TypeError
                    return;
                }

                if (parent.type === 'AssignmentExpression' && parent.left === node) {
                    // Not a read
                } else {
                    var access = {
                        kind: 'variable',
                        name: node.name,
                        source: node.name
                    };

                    accesses.push(access);
                }
            },
            MemberExpression: function (node, st, ancestors) {
                if (!node.computed) {
                    getAccessPath(node.object, function (prefixPath) {
                        var parent = ancestors[ancestors.length - 2];
                        if (parent.type === 'AssignmentExpression' && parent.left === node) {
                            // Not a read
                        } else {
                            var access = {
                                kind: 'member',
                                object: prefixPath,
                                property: node.property.name,
                                source: prefixPath.join('.') + '.' + node.property.name
                            };

                            var prefixes = [];
                            for (var i = 0; i < access.object.length; ++i) {
                                var name = access.object[i];
                                if (prefixes.length) {
                                    prefixes.push(prefixes[prefixes.length-1] + '.' + name);
                                } else {
                                    prefixes.push(name);
                                }
                            }

                            accesses.push(access);
                        }
                    });
                }
            },
            VariableDeclaration: function (node, st, ancestors) {
                for (var i = 0; i < node.declarations.length; ++i) {
                    locals.push(node.declarations[i].id.name);
                }
            }
        });
    } catch (e) {
        // Do not crash in case of syntax errors
        if (!(e instanceof SyntaxError)) {
            console.warn('Unexpected error', e);
        }
    }
    return { accesses: accesses, assignments: assignments, locals: locals };
}

function extractAllReads(node, requireTypeofCheck, acc) {
    if (!acc) {
        acc = new natives.refs.Set.ref();
    }
    walk.simple(node, {
        Identifier: function (node) {
            if (requireTypeofCheck && !(parent.type === 'UnaryExpression' && parent.operator === 'typeof')) {
                return;
            }
            acc.add(node.name);
        },
        MemberExpression: function (node) {
            if (requireTypeofCheck && !(parent.type === 'UnaryExpression' && parent.operator === 'typeof')) {
                return;
            }
            getAccessPath(node, function (path) {
                acc.add(path.join('.'));
            });
        }
    });
    return acc;
}

function extractCode(f) {
    while (bindings.has(f)) {
        // If f = g.bind(...), then use the source code of g, since
        // f.toString() will be "function f() { [native code] }"
        f = bindings.get(f);
    }
    var code = f.toString();
    if (code.substring(0, 10) === 'function (') {
        // Give the function a name (a function without a name
        // is not syntactically correct...)
        code = 'function anonymous' + code.substring(9);
    }
    code = deinstrumentJavaScript(code);
    return code;
}

function printAst(ast, code) {
    try {
        var ast = acorn.parse(code, {
            allowReturnOutsideFunction: true
        });
        return esotope.generate(ast, { comment: true });
    } catch (e) {
        // Could not parse code coming from a real function.
        // It may be a native function, or due to an internal
        // error in the acorn parser.
        return code;
    }
}

function getAccessPath(node, cb) {
    if (node.type === 'Identifier') {
        cb([node.name]);
    } else if (node.type === 'MemberExpression' && !node.computed) {
        getAccessPath(node.object, function (accessPath) {
            accessPath.push(node.property.name);
            cb(accessPath);
        });
    }
}

/**
 * Performs a light-weight, syntactic analysis of the event handler.
 */
function getTypeErrors(f, maxDepth) {
    var result = [];
    var typeErrorsSoFar = new natives.refs.Set.ref();

    function visit(f, depth) {
        if (depth >= maxDepth) {
            // Max depth reached; stop exploration
            return;
        }

        var evaluator = scoping.getEvaluator(f);
        if (typeof evaluator !== 'function') {
            // Give up
            return;
        }

        var ast = buildAst(f);
        if (ast == null) {
            // Give up
            return;
        }

        var { accesses, assignments, locals } = extractAccessesInAst(ast);
        for (var i = 0; i < accesses.length; ++i) {
            var access = accesses[i];

            access.depth = depth;
            access.isAssigned = false;
            access.isPrefixAssigned = false;
            access.isLikelyBrowserDependent = false;

            if (access.kind === 'call') {
                // access is of the kind `f()`
                if (locals.indexOf(access.callee[0]) >= 0) {
                    // The expression starts from a local variable, ignore...
                    continue;
                }

                switch (access.callee[access.callee.length - 1]) {
                    case 'attachEvent':
                    case 'detachEvent':
                        // These are IE specific functions...
                        access.isLikelyBrowserDependent = true;
                }

                var callee = access.callee.join('.');
                access.isAssigned = assignments.some(function (assignment) {
                    return callee === assignment.source;
                });
                if (access.callee.length > 1) {
                    access.isPrefixAssigned = assignments.some(function (assignment) {
                        return callee.indexOf(assignment.source + '.') === 0;
                    });
                }

                var g = evaluateAccessPath(access.callee, evaluator, function (err, val) {
                    if (err) {
                        // Do not mark this access; it is not failing due to the call,
                        // but due to the property access...
                    } else {
                        access.throwsAtDeclaration = typeof val !== 'function';
                    }
                    return val;
                });

                if (typeof g === 'function') {
                    // Continue exploration inside `g`
                    visit(g, depth+1);
                }
            } else if (access.kind === 'member') {
                // access is of the kind `o.p`
                if (locals.indexOf(access.object[0]) >= 0) {
                    // Ignore; the expression starts from a local variable...
                    continue;
                }

                if (access.object[0] === 'event') {
                    // Ignore; window.event is only set by IE?
                    access.isLikelyBrowserDependent = true;
                }

                access.isAssigned = assignments.some(function (assignment) {
                    return access.source === assignment.source;
                });
                access.isPrefixAssigned = assignments.some(function (assignment) {
                    return access.source.indexOf(assignment.source + '.') === 0;
                });

                evaluateAccessPath(access.object, evaluator, function (err, val) {
                    access.throwsAtDeclaration = !err && !val;
                });
            } else if (access.kind === 'variable') {
                if (locals.indexOf(access.name) >= 0) {
                    // Ignore; the expression starts from a local variable...
                    continue;
                }

                if (access.name === 'event') {
                    // Ignore; window.event is only set by IE?
                    access.isLikelyBrowserDependent = true;
                }

                access.isAssigned = assignments.some(function (assignment) {
                    return access.source === assignment.source;
                });

                // access is of the kind `x`
                evaluateAccessPath([access.name], evaluator, function (err, val) {
                    if (err) {
                        access.throwsAtDeclaration = true;
                    }
                });
            }

            if (access.throwsAtDeclaration) {
                // Avoid reporting the same error twice
                var expression = accessToString(access);
                if (!typeErrorsSoFar.has(expression)) {
                    result.push({ access: access, enclosingFunction: f });
                    typeErrorsSoFar.add(expression);
                }
            }
        }
    }
    visit(f, 0);
    return result;
}

function isFunctionReadingParameter(f, code) {
    var ast = buildAst(f, code);
    if (ast) {
        var decl = ast.body[0];
        var reads = extractAllReads(ast);
        return reads.has('arguments') || decl.params.some(function (param) {
            return reads.has(param.name);
        });
    }
    return false;
}

module.exports = {
    extractCode: extractCode,
    getTypeErrors: getTypeErrors,
    isFunctionReadingParameter: isFunctionReadingParameter
};
