#!/usr/bin/env node

var argv = require('yargs')
    .usage('Usage: ./initracer.js --site <site> --url <url>')
    .option('build', { default: true, type: 'boolean' })
    .option('manual', { default: false, type: 'boolean' })
    .option('validate', { default: false, type: 'boolean' })
    .option('replay', { default: false, type: 'boolean' })
    .option('screenshot', { default: true, type: 'boolean' })
    .option('site', { type: 'string' })
    .option('skip', { default: false, type: 'boolean' })
    .option('mode', { default: 'observation', choices: ['adverse', 'build', 'observation', 'screenshot'], type: 'string' })
    .option('upload', { choices: ['live', 'replay'], type: 'string' })
    .option('url', { default: 'http://cs.au.dk/~cqa', type: 'string' })
    .option('watch', { default: true, type: 'boolean' })
    .help()
    .argv;

// External
var browserify = require('browserify');
var child_process = require('child_process');
var chokidar = require('chokidar');
var colors = require('colors'); 
var fs = require('fs');
var mkdirp = require('mkdirp');
var os = require('os');
var path = require('path');
var Q = require('q');
var util = require('util');

// Internal
var Job = require('./src/driver/jobs.js').Job;
var proxy = require('./src/driver/proxy.js');

var root = __dirname;

if ((argv.mode === 'observation' || argv.mode === 'screenshot') && argv.validate) {
    console.error('Invalid arguments'.red.bold);
    process.exit(1);
}

var hasUploadAccess = fs.existsSync('initracer-sk.txt');

proxy.isChromeStartedWithoutProxy()
.then(function (chromeStartedWithoutProxy) {
    if (chromeStartedWithoutProxy && !argv.site) {
        console.error("Please close Chrome prior to running InitRacer".red.bold);
        console.error("(Chrome needs to be started with special flags to use the proxy)".red.bold);
        process.exit(1);
    }
})
.then(function () {
    return buildInitRacer();
})
.then(function () {
    console.log("Starting InitRacer".blue.bold);
    return startInitRacer();
})
.then(function (shutdown) {
    if (shutdown) {
        process.exit(0);
    }
})
.catch(function (e) {
    console.error("Unexpected error".red.bold);
    console.error(e);
    process.exit(1);
});

// Automatically rebuild if the sources change
if (argv.watch) {
    chokidar.watch('src').on('change', function (file) {
        buildInitRacer(true);
    });
}

/**
 * Asynchronously builds the InitRacer runtime using browserify.
 */
function buildInitRacer(rebuild) {
    var deferred = Q.defer();

    if (argv.build || rebuild) {
        if (rebuild) {
            console.log("Rebuilding InitRacer".blue.bold);
        } else {
            console.log("Building InitRacer".blue.bold);
        }

        mkdirp.sync('out');

        var bundle = browserify()
        .require('./src/analysis.js', { expose: 'initracer' })
        .bundle();

        var bundleCode = '';
        bundle.on('data', function (data) {
            bundleCode += data;
        });
        bundle.on('error', function () {
            console.log(arguments);
        });
        bundle.on('end', function() {
            var result = [
                '(function() {',
                '  if (typeof window.initRacer === \'object\') return;',
                '  var require;',
                '  ' + bundleCode,
                '  require(\'initracer\')();',
                '})();'
            ].join('\n');
            fs.writeFile('out/bundle.js', result, deferred.resolve);
        });
    } else {
        deferred.resolve();
    }

    return deferred.promise.then(function () {
        if (argv.mode === 'build') {
            process.exit(0);
        }
    });
}

/**
 * Starts InitRacer. Assumes that the proxy is already running.
 * This function has two possible behaviors:
 * (1) If the command line option --site is present, then
 *     InitRacer is run on the argument passed to --url.
 *     The browser is closed automatically, and the result is
 *     stored in /<out>/<site>.
 * (2) Otherwise, the argument passed to --url is opened in
 *     Google Chrome.
 */
function startInitRacer() {
    var deferred = Q.defer();

    if (argv.site && !argv.manual) {
        new Job(argv.site, argv.url, argv).run(argv.site, argv.url)
        .then(upload.bind(null, argv.site))
        .then(deferred.resolve.bind(deferred, true));
    } else {
        proxy.start(8081, argv.mode, argv.replay ? argv.site : null, null)
        .then(function () {
            console.log('Starting Chrome on port 8081'.blue.bold);

            var cmd = os.platform() === 'darwin'
                ? 'open -a "Google Chrome" --args %s --proxy-server="127.0.0.1:8081" --proxy-bypass-list=""' // Mac
                : 'nohup google-chrome-stable %s --proxy-server="127.0.0.1:8081" --proxy-bypass-list=""'; // Ubuntu

            child_process.exec(util.format(cmd, argv.url), function (error, stdout, stderr) {
                deferred.resolve(false);
            });
        })
        .catch(function (e) {
            console.log(e.toString().red.bold);
        });
    }

    return deferred.promise;
}

function upload(site) {
    var deferred = Q.defer();

    if (argv.upload && hasUploadAccess) {
        console.log('Uploading to initracer.casadev.cs.au.dk'.blue.bold);

        var counter = 0;

        var sitedir = path.join('out', site);
        if (fs.existsSync(sitedir)) {
            var args1 = ['-r', '-P', '10022', '-i', 'initracer-sk.txt', sitedir,
                'initraceruser@casadev.cs.au.dk:/data/initracer_website/public_html/' + argv.upload + '/out/'];

            var scp1 = child_process.spawn('scp', args1,
                { cwd: root, stdio: 'inherit' });

            scp1.on('close', function (code) {
                if (++counter == 2) deferred.resolve();
            });
        } else {
            if (++counter == 2) deferred.resolve();
        }

        var summarydest = 'out/summary.json';
        if (fs.existsSync(summarydest)) {
            var args2 = ['-P', '10022', '-i', 'initracer-sk.txt', summarydest,
                'initraceruser@casadev.cs.au.dk:/data/initracer_website/public_html/' + argv.upload + '/out/'];

            var scp2 = child_process.spawn('scp', args2,
                { cwd: root, stdio: 'inherit' });

            scp2.on('close', function (code) {
                if (++counter == 2) deferred.resolve();
            });
        } else {
            if (++counter == 2) deferred.resolve();
        }
    } else {
        deferred.resolve();
    }

    return deferred.promise;
}
