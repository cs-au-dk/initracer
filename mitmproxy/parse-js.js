#!/usr/bin/env node

var acorn = require('acorn');

function parsejs(input) {
    try {
    	acorn.parse(input);
    	return true;
    } catch (e) {
    }
}

if (require.main === module) {
    var input = '';

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', function (data) {
        input += data;
    });
    process.stdin.on('end', function () {
        process.stdout.write(parsejs(input) ? '' : 'SyntaxError\n');
    });
}
