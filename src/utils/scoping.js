var bindings = require('./bindings.js');

/**
 * A map from functions to a function, that takes a string and
 * evaluates that string, in the context where the function was defined.
 *
 * Example: Consider the following piece of code.
 *
 * var fun = (function () {
 *   function g() {}
 *   function f() { g(); }
 *   return f;  
 * })();
 * button.addEventListener('click', fun, false);
 *
 * At the time `fun` is registered as an event handler, it is possible
 * to retrieve the source of the function. It is possible to see, that it
 * invokes a function called g(). A naive attempt to check if that invocation
 * may fail, would be to check if `window.g` is a function, and otherwise report
 * a warning. As the example illustrates, though, `g` does not have to be present
 * in the global scope in order for the call to succeed.
 *
 * This problem is addressed by `scoping.js`. For every function `f`
 * it stores an additional function `(e) => eval(e)`, which is defined
 * in the same syntactic location as `f`.
 *
 * In order to determine if `g` is defined at `f`, it is possible to do the following check.
 *
 * var evaluator = getEvaluator(fun);
 * var g = evaluator('g');
 * assert(typeof g === 'function');
 */

var evaluators = new Map();

/**
 * Calling eval indirectly will cause the expression to be evaluated in the global scope.
 */
function globalEvaluator(e) {
	var _eval = eval;
	return _eval(e);
}

function getEvaluator(f) {
	while (bindings.has(f)) {
		f = bindings.get(f);
	}
	return evaluators.get(f);
}

function registerEvaluator(f, evaluator) {
    evaluators.set(f, evaluator);
    return f;
}

module.exports = {
    globalEvaluator: globalEvaluator,
    getEvaluator: getEvaluator,
    registerEvaluator: registerEvaluator
};
