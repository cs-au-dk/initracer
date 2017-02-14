var child_process = require('child_process');
var colors = require('colors'); 
var fs = require('fs');
var lsof = require('lsof');
var os = require('os');
var path = require('path');
var Q = require('q');
var util = require('util');

var root = path.join(__dirname, '../..');

/**
 * Checks whether Chrome has been started with the proxy flags.
 * This function returns a boolean asynchronously.
 */
function isChromeStartedWithoutProxy() {
    var deferred = Q.defer();
    child_process.exec(util.format('ps %s', os.platform() === 'darwin' ? '-e' : 'aux'), function(err, stdout, stderr) {
        stdout = stdout.toString('utf8');
        stderr = stderr.toString('utf8');
        if (err || stderr) {
            deferred.reject(stderr || err);
        } else {
            var lines = stdout.split('\n');
            deferred.resolve(lines.some(function (line) {
                var appearsToBeChrome =
                    line.indexOf('/Google Chrome.app/Contents/MacOS') >= 0 ||
                    line.indexOf('/opt/google/chrome/chrome') >= 0;
                return appearsToBeChrome && line.indexOf('--proxy-server') < 0;
            }));
        }
    });
    return deferred.promise;
}

/**
 * Checks whether the proxy has been started.
 * This function returns a boolean asynchronously.
 */
function isStarted(port) {
    var deferred = Q.defer();
    lsof.rawTcpPort(port, function (data) {
        deferred.resolve(data.length > 0);
    });
    return deferred.promise;
}

/**
 * Checks whether the proxy has been started.
 * This function returns a boolean asynchronously.
 */
function kill(port) {
    var deferred = Q.defer();
    lsof.rawTcpPort(port, function (data) {
        data.forEach(function (p) { process.kill(p.pid); });
        setTimeout(function () {
            deferred.resolve();
        }, 500);
    });
    return deferred.promise;
}

/**
 * Starts the proxy (i.e., a mitmdump process) asynchronously.
 * The returned promise is resolved when the proxy has been started.
 */
function start(port, mode, recording, env) {
    var deferred = Q.defer();

    kill(port).then(function () {
        // Start the mitmdump process
        var script = 'mitmproxy/proxy.py --mode ' + mode;
        var args = ['--quiet', '--anticache', '--no-http2', '-p', port, '-s', script];
        if (recording) {
            var loc = path.join('recordings', recording);
            if (fs.existsSync(loc)) {
                args.push('-S', loc, '--no-pop', '--kill');
            } else {
                console.error(util.format('Error: No recording at %s', loc).red.bold);
            }
        }

        console.log(util.format('Starting proxy on port %s (mitmdump %s)', port, args.join(' ')).blue.bold);

        var mitmdump = child_process.spawn('mitmdump', args,
            { cwd: root, detached: true, env: env || process.env, stdio: 'ignore' });

        mitmdump.on('error', function (e) {
            deferred.reject(e);
        });

        // Resolve the promise when the proxy seems to have started
        // (keep checking every 200 ms)
        var interval = 200, waited = 0, maxWait = 20000;
        var intervalId = setInterval(function () {
            isStarted(port).then(function (proxyStarted) {
                if (proxyStarted) {
                    setTimeout(function () {
                        deferred.resolve();
                    }, 500);
                    clearInterval(intervalId);
                } else if (waited >= maxWait) {
                    // Timeout, 20s have elapsed and mitmproxy is still not there!
                    deferred.reject();
                } else {
                    waited += interval;
                }
            });
        }, interval);
    });

    return deferred.promise;
}

module.exports = {
    isChromeStartedWithoutProxy: isChromeStartedWithoutProxy,
    start: start
};
