// External
var child_process = require('child_process');
var colors = require('colors'); 
var fs = require('fs');
var os = require('os');
var path = require('path');
var Q = require('q');
var util = require('util');

// Internal
var proxy = require('./proxy.js');

var root = path.join(__dirname, '../..');

function cleanUpAfterProtractor() {
    var deferred = Q.defer();

    if (os.platform() === 'darwin') {
        try {
            console.log('pkill -f "Google Chrome"'.blue.bold);
            child_process.execSync('pkill -f "Google Chrome"');
        } catch (e) {
        }
        try {
            console.log('pkill -f chromedriver'.blue.bold);
            child_process.execSync('pkill -f chromedriver');
        } catch (e) {
        }
    } else {
        try {
            console.log('pkill -f chrome'.blue.bold);
            child_process.execSync('pkill -f chrome');
        } catch (e) {
        }
    }

    setTimeout(function () {
        deferred.resolve();
    }, 1000);

    return deferred.promise;
}

function makeEnv(envVars) {
    var env = Object.create(process.env);
    if (envVars) {
        for (var variable in envVars) {
            if (envVars.hasOwnProperty(variable)) {
                env[variable] = envVars[variable];
            }
        }
    }
    return env;
}

function Job(site, url, options) { // options: { mode, skip, validate }
    this.site = site;
    this.url = url;

    this.deferred = Q.defer();
    this.dest = path.join('out', site, 'race-report.json');
    this.options = options;
    this.specifications = [];

    if (options.screenshot) {
        this.specifications.push(this.getScreenshotModeSpecification());
    }

    this.specifications.push(this.getAdverseModeSpecification());
    this.specifications.push(this.getObservationModeSpecification());

    if (options.mode) {
        this.specifications = this.specifications.filter(function (specification) {
            return specification.mode === options.mode || specification.mode === 'screenshot';
        });
    }
}

Job.prototype.getAccessBeforeDefinitionRaces = function () {
    if (fs.existsSync(this.dest)) {
        var report = JSON.parse(fs.readFileSync(this.dest));
        return report.accessBeforeDefinitionRaces;
    }
    return [];
};

Job.prototype.getTiming = function (mode) {
    if (fs.existsSync(this.dest)) {
        var report = JSON.parse(fs.readFileSync(this.dest));
        return report.info.timing[mode];
    }
    return null;
};

/**
 * Phase 1: Observation mode.
 */
Job.prototype.getObservationModeSpecification = function () {
    return {
        port: 8081,
        mode: 'observation',
        env: makeEnv,
        skip: this.options.skip && typeof this.getTiming('observation') === 'number',
        onFinish: function (time) {
            if (typeof time === 'number') {
                this.updateTiming('observation', time);
            }
        }.bind(this),
        toString: function () {
            return 'observation[' + this.site + ']';
        }.bind(this)
    };
};

/**
 * Phase 2: Adverse mode.
 */
Job.prototype.getAdverseModeSpecification = function () {
    return {
        port: 8081,
        mode: 'adverse',
        env: makeEnv,
        skip: this.options.skip && typeof this.getTiming('adverse') === 'number',
        onFinish: function (time) {
            if (typeof time === 'number') {
                this.updateTiming('adverse', time);
                this.updateTiming('validation', 0);
            }

            if (this.options.validate) {
                Array.prototype.push.apply(
                    this.specifications,
                    this.getValidationModeSpecifications());
            }
        }.bind(this),
        toString: function () {
            return 'adverse[' + this.site + ']';
        }.bind(this)
    };
};

/**
 * Phase 3: Validation mode.
 */
Job.prototype.getValidationModeSpecifications = function () {
    return this.getAccessBeforeDefinitionRaces()
        .map(function (race, i) {
            if (race.isDepthOneValidated) {
                return null;
            }
            return {
                port: 8081,
                mode: 'validation',
                env: () => makeEnv({
                    INITRACER_INJECTION_SPEC: JSON.stringify({ index: i, report: race })
                }),
                onFinish: function (time) {
                    if (typeof time === 'number') {
                        this.updateTiming('validation', time, true);
                    }
                }.bind(this),
                toString: function () {
                    return 'validation[' + this.site + ', ' + i + ']';
                }.bind(this)
            };
        }.bind(this))
        .filter(function (specification) { return !!specification; });
}

/**
 * Screenshot mode.
 */
Job.prototype.getScreenshotModeSpecification = function () {
    return {
        port: 8081,
        mode: 'screenshot',
        env: () => {
            var report = JSON.parse(fs.readFileSync(this.dest));
            var tooltipDescriptors = [];

            report.accessBeforeDefinitionRaces.forEach(function (race) {
                if (race.important && race.isTargetStaticElement) {
                    tooltipDescriptors.push({
                        elementId: race.elementId,
                        raceId: race.id,
                        category: 'ABD',
                        kind: race.type,
                    });
                }
            });

            report.formInputOverwrittenRaces.forEach(function (race) {
                if (race.important && race.isTargetStaticElement) {
                    tooltipDescriptors.push({
                        elementId: race.elementId,
                        raceId: race.id,
                        category: 'FIO',
                        kind: race.kind,
                    });
                }
            });

            report.lateEventHandlerRegistrationRaces.forEach(function (race) {
                if (race.important && race.isTargetStaticElement) {
                    tooltipDescriptors.push({
                        elementId: race.elementId,
                        raceId: race.id,
                        category: 'LEHR',
                        kind: race.type,
                    });
                }
            });

            return makeEnv({
                INITRACER_TOOLTIP_SPEC: JSON.stringify(tooltipDescriptors)
            });
        },
        toString: function () {
            return 'screenshot[' + this.site + ']';
        }.bind(this)
    };
};

Job.prototype.executeSpecification = function (job, retryOnFailure) {
    var env = job.env();

    proxy.start(job.port, job.mode, this.options.replay ? this.site : null, env).then(function () {
        console.log(util.format('Starting job: %s', job.toString()).blue.bold);

        var args = [
            'protractor_conf.js', '--disableChecks', '--site', this.site, '--url', this.url,
            '--port', job.port, '--mode', job.mode];

        var started = Date.now();
        var protractor = child_process.spawn("protractor", args,
            { cwd: root, env: env, stdio: 'inherit' });

        var timer = setTimeout(exitHandler.bind(this, 1, true), 120000);
        protractor.on('close', function (code) {
            exitHandler.call(this, code, false);
        }.bind(this));

        var hasFinished = false;

        function exitHandler(code, timeout) {
            if (hasFinished) {
                return;
            } else {
                hasFinished = true;
                if (timeout) {
                    protractor.kill();
                } else {
                    clearTimeout(timer);
                }
            }

            var time = Date.now()-started;

            if (code === 0) {
                console.log(util.format('Job succeeded').green.bold);
            } else {
                console.error(util.format('Job failed (exit code: %s, timeout: %s)', code, !!timeout).red.bold);
            }

            // Kill Chrome and chromedriver instances
            cleanUpAfterProtractor()
            .then(function () {
                if (retryOnFailure && code !== 0) {
                    // Retry
                    console.log('Retrying'.blue.bold);
                    this.executeSpecification(job, false);
                } else {
                    this.executeNextSpecification(job, time);
                }
            }.bind(this))
            .catch(function (e) {
                console.log(e.toString().red.bold);
            });
        }
    }.bind(this))
    .catch(function (e) {
        console.error('Error starting mitmdump'.red.bold, e);
    });
};

Job.prototype.executeNextSpecification = function (prevJob, time) {
    if (prevJob && typeof prevJob.onFinish === 'function') {
        prevJob.onFinish(time);
    }

    if (this.specifications.length) {
        var specification = this.specifications.pop();
        if (specification.skip) {
            console.log(util.format('Skipping specification: %s', specification.toString()).blue.bold);
            this.executeNextSpecification(specification, null)
        } else {
            setTimeout(function () {
                this.executeSpecification(specification, true);
            }.bind(this), 500);
        }
    } else {
        this.deferred.resolve(true);
    }
};

Job.prototype.run = function () {
    this.executeNextSpecification();
    return this.deferred.promise;
}

Job.prototype.updateTiming = function (mode, time, increment) {
    if (fs.existsSync(this.dest)) {
        var report = JSON.parse(fs.readFileSync(this.dest));
        var timing = report.info.timing || (report.info.timing = {});
        if (increment) {
            timing[mode] += time;
        } else {
            timing[mode] = time;
        }
        fs.writeFileSync(this.dest, JSON.stringify(report, undefined, 2));

        var summarydest = 'out/summary.json';
        if (fs.existsSync(summarydest)) {
            var summary = JSON.parse(fs.readFileSync(summarydest));
            summary[this.site].info.timing = timing;
            fs.writeFileSync(summarydest, JSON.stringify(summary, undefined, 2));
        }
    }
};

module.exports = {
    Job: Job
};
