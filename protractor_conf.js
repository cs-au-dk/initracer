#!/usr/bin/env node

var argv = require('yargs')
    .usage('Usage: protractor protractor_conf.js --site <site> --url <url>')
    .option('mode', { choices: ['adverse', 'observation', 'screenshot', 'validation'], default: 'observation', type: 'string' })
    .option('site', { demand: true, type: 'string' })
    .option('url', { demand: true, type: 'string' })
    .option('port', { default: '8081', type: 'string' })
    .argv;

var chromeArgs = ['--proxy-server=127.0.0.1:' + argv.port, '--proxy-bypass-list=', '--window-size=1600,900'];

exports.config = {
    directConnect: true,

    // Capabilities to be passed to the webdriver instance.
    capabilities: {
        'browserName': 'chrome',
        'chromeOptions': {
            args: chromeArgs
        }
    },

    // Framework to use. Jasmine is recommended.
    framework: 'jasmine',

    jasmineNodeOpts: {
        defaultTimeoutInterval: 120000,
        print: function() { /* ignore stack trace */ }
    },

    // Spec patterns are relative to the current working directly when
    // protractor is called.
    specs: ['spec.js'],

    params: argv
};
