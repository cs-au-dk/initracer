// Credit: https://github.com/Samsung/jalangi2

var _eval = eval;

function callAsConstructor(Constructor, args) {
    var ret;
    if (true) {
        ret = callAsNativeConstructor(Constructor, args);
        return ret;
    } else { // else branch is a more elegant to call a constructor reflectively, but it leads to memory leak in v8.
        var Temp = function () {
        }, inst;
        Temp.prototype = Constructor.prototype;
        inst = new Temp;
        ret = Constructor.apply(inst, args);
        return Object(ret) === ret ? ret : inst;
    }
}

function callAsNativeConstructor(Constructor, args) {
    if (args.length === 0) {
        return new Constructor();
    }
    if (args.length === 1) {
        return new Constructor(args[0]);
    }
    if (args.length === 2) {
        return new Constructor(args[0], args[1]);
    }
    if (args.length === 3) {
        return new Constructor(args[0], args[1], args[2]);
    }
    if (args.length === 4) {
        return new Constructor(args[0], args[1], args[2], args[3]);
    }
    if (args.length === 5) {
        return new Constructor(args[0], args[1], args[2], args[3], args[4]);
    }
    return callAsNativeConstructorWithEval(Constructor, args);
}

function callAsNativeConstructorWithEval(Constructor, args) {
    var a = [];
    for (var i = 0; i < args.length; i++)
        a[i] = 'args[' + i + ']';
    var eval = _eval;
    return eval('new Constructor(' + a.join() + ')');
}

module.exports = {
	callAsConstructor: callAsConstructor
};
