#!/usr/bin/env node

// External
var argv = require('yargs')
    .option('kind', { demand: true, options: ['html', 'js'] })
    .option('o', { demand: false })
    .argv;
var fs = require('fs');

// Internal
var instrumentHtml = require('./instrumentation/instrument-html.js');
var instrumentJavaScript = require('./instrumentation/instrument-js.js');

// Read the file to be instrumented from stdin
var input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', function (data) {
    input += data;
});
process.stdin.on('end', function () {
    var mode = process.env.INITRACER_MODE;

    // By now, the entire file to be instrumented has been read from stdin.
    // If 'html' was passed to --kind, then instrument as HTML.
    // Otherwise, instrument as JavaScript.
    var output;
    if (argv.kind === 'html') {
        output = instrumentHtml(input);
    } else if (mode !== 'screenshot') {
        output = instrumentJavaScript(input, {
            allowReturnOutsideFunction: false,
            isExternal: true,
            url: process.env.INITRACER_URL
        });
    } else {
        output = input;
    }

    // If a file name has been passed to the --o option,
    // then store the instrumented file there.
    // Otherwise, write the instrumented file to stdout.
    if (argv.o) {
        fs.writeFile(argv.o, output.toString());
    } else {
        process.stdout.write(output.toString());
    }
});
