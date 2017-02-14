// Internal
var reports = require('./src/utils/reports.js');

// External
var argv = browser.params;
var colors = require('colors');
var fs = require('fs');
var images = require('images');
var mkdirp = require('mkdirp');
var path = require('path');
var rimraf = require('rimraf');
var util = require('util');

var reportdir = path.join(__dirname, 'report');
var outdir = path.join('out', argv.site);
var out = path.join(outdir, 'race-report.json');

var reportDest = path.join(outdir, 'race-report.json');
var summaryDest = path.join(outdir, '../summary.json');

mkdirp.sync(outdir);

describe('Race detection', function () {
    function test(f, done) {
        console.log(util.format('Opening %s', argv.url).blue.bold);

        browser.driver.get(argv.url);
        browser.ignoreSynchronization = true;

        console.log('Waiting for analysis to finish'.blue.bold);

        // Wait for the dynamic analysis to finish
        if (argv.mode !== 'screenshot') {
            browser.wait(function () {
                return browser.executeScript("return initRacer.analysisFinished").then(function(analysisFinished) {
                    return analysisFinished === true;
                });
            }, 15000);
        }

        f().then((options) => {
            if (options && options.report) {
                console.log(util.format('Storing report at %s', reportDest).blue.bold);
                fs.writeFileSync(reportDest, JSON.stringify(options.report, undefined, 2));
            }

            if (options && options.summary) {
                console.log(util.format('Storing summary at %s', summaryDest).blue.bold);
                fs.writeFileSync(summaryDest, JSON.stringify(options.summary, undefined, 2));
            }

            console.log('Done'.blue.bold);
            done();
        });
    }

    if (argv.mode === 'adverse' || argv.mode === 'screenshot' || argv.mode === 'validation') {
        it('should detect races', function (done) {
            if (fs.existsSync(reportDest)) {
                if (argv.mode === 'adverse') {
                    test(adverseMode, done);
                } else if (argv.mode === 'screenshot') {
                    test(screenshotMode, done);
                } else if (argv.mode === 'validation') {
                    test(validationMode, done);
                }
            }
        });
    } else {
        if (fs.existsSync(reportDest)) {
            console.log('Deleting old report'.blue.bold);
            rimraf.sync(reportDest);
        }

        it('should detect races', function (done) {
            test(observationMode, done);
        });
    }
});

function observationMode() {
    return browser.executeScript("initRacer.lateEventHandlerRegistrationRaceDetector.setCallsPreventDefault();")
        .then(() => {
            // Generate the report
            console.log('Fetching JSON (mode: observation)'.blue.bold);
            return browser.executeScript(util.format("return JSON.stringify({ report: initRacer.getReport('%s'), summary: initRacer.getSummary('%s') });", argv.site, argv.site));
        })
        .then(JSON.parse)
        .then(result => {
            // Store the summary outside the report directory
            var summaries = {};
            if (fs.existsSync(summaryDest)) {
                summaries = JSON.parse(fs.readFileSync(summaryDest));
            }
            summaries[argv.site] = result.summary;
            return { report: result.report, summary: summaries };
        });
}

function adverseMode() {
    var report = JSON.parse(fs.readFileSync(reportDest));
    var summary = JSON.parse(fs.readFileSync(summaryDest));

    console.log('Fetching JSON (mode: adverse)'.blue.bold);
    return browser.executeScript("return JSON.stringify({ info: initRacer.info.getReport(), report: initRacer.accessBeforeDefinitionRaceDetector.getReport(), summary: initRacer.accessBeforeDefinitionRaceDetector.getSummary() });")
        .then(JSON.parse)
        .then((result) => {
            var info = result.info, accessBeforeDefinitionRaces = result.report, abdSummary = result.summary;

            console.log(util.format('Result: %s invoked event handlers (%s failing, %s skipped) -> %s reports',
                abdSummary.user.executed + abdSummary.system.executed,
                abdSummary.user.failing + abdSummary.system.failing,
                abdSummary.user.skipped + abdSummary.system.skipped,
                accessBeforeDefinitionRaces.length).blue.bold);

            // Update the report for the current site
            report.accessBeforeDefinitionRaces = accessBeforeDefinitionRaces;

            // Update the summary for the current site
            var siteSummary = summary[argv.site];
            siteSummary.info.uncaughtExceptions.adverse = info.uncaughtExceptions.adverse;
            siteSummary.info.urls.adverse = info.urls.adverse;
            siteSummary.accessBeforeDefinitionRaces = abdSummary;

            return { report: report, summary: summary };
        });
}

function validationMode() {
    var injectionSpec = JSON.parse(process.env.INITRACER_INJECTION_SPEC);

    console.log(util.format('Triggering injection specification #%s', injectionSpec.index).blue.bold);
    return browser.executeScript(
            "return JSON.stringify(initRacer.accessBeforeDefinitionRaceDetector.getSummary());"
        )
        .then(JSON.parse).then(function (abdSummary) {
            if (abdSummary.user.executed + abdSummary.system.executed === 0) {
                console.log('No event handler invoked'.blue.bold);
            } else if (abdSummary.user.executed + abdSummary.system.executed > 1) {
                console.log('Multiple event handlers invoked'.blue.bold);
            } else {
                var report = JSON.parse(fs.readFileSync(reportDest));
                var summary = JSON.parse(fs.readFileSync(summaryDest));

                var races = report.accessBeforeDefinitionRaces;
                if (injectionSpec.index < races.length) {
                    var race = races[injectionSpec.index];
                    race.isDepthOneValidated = true;
                    if (race.isDepthOneError = abdSummary.user.failing + abdSummary.system.failing === 1) {
                        if (race.isUserEvent) {
                            ++summary[argv.site].accessBeforeDefinitionRaces.user.validated;
                        } else {
                            ++summary[argv.site].accessBeforeDefinitionRaces.system.validated;
                        }
                    }

                    // Check if it is also an initialization error
                    if (!race.isInitializationErrorValidated) {
                        return browser.executeScript(
                            'initRacer.accessBeforeDefinitionRaceDetector.resetSummary(); initRacer.accessBeforeDefinitionRaceDetector.triggerExitListeners(); return JSON.stringify(initRacer.accessBeforeDefinitionRaceDetector.getSummary());'
                        )
                        .then(JSON.parse).then(function (abdPostSummary) {
                            race.isInitializationErrorValidated = true;
                            if (race.isInitializationError = abdPostSummary.user.failing + abdPostSummary.system.failing === 0) {
                                if (race.isUserEvent) {
                                    ++summary[argv.site].accessBeforeDefinitionRaces.user.initializationErrors;
                                } else {
                                    ++summary[argv.site].accessBeforeDefinitionRaces.system.initializationErrors;
                                }
                            }

                            return { report: report, summary: summary };
                        });
                    }
                }
                return { report: report, summary: summary };
            }
        });
}

function screenshotMode() {
    var report = JSON.parse(fs.readFileSync(reportDest));
    var racesWithElementId = 
        report.accessBeforeDefinitionRaces
        .concat(report.formInputOverwrittenRaces)
        .concat(report.lateEventHandlerRegistrationRaces)
        .filter((race) => !!race.elementId);
    var elementIds =
        racesWithElementId
        .map((race) => race.elementId)
        .filter((elementId, index, elementIds) => elementIds.indexOf(elementId) === index);

    return browser.executeScript(util.format('return JSON.stringify((%s).map(function (id) { try { var $e = initRacer._$(\'#\' + id); return { elementId: id, offset: $e.offset(), size: { height: $e.outerHeight(), width: $e.outerWidth() } }; } catch (e) { return null; } }));', JSON.stringify(elementIds)))
        .then(JSON.parse)
        .then(layout => {
            racesWithElementId.forEach(function (race) {
                race.layout = layout.find((x) => x !== null && x.elementId === race.elementId);
            });
        })
        .then(() => browser.executeScript('initRacer.createTooltips(argv.tooltipDescriptors)'))
        .then(function () {
            return browser.wait(function () {
                return browser.executeScript("return argv.tooltipDescriptors.length;").then(function(remaining) {
                    return remaining === 0;
                });
            }, 60000);
        })
        .then(() => {
            // Take screenshot(s) of the web page
            console.log('Taking screenshots'.blue.bold);
            return takeScreenshots();
        })
        .then(data => {
            // Output the screenshots to the report directory
            console.log(util.format('Storing screenshot in %s', data.pngs.length, outdir).blue.bold);
            
            var imgs = data.pngs.map((png) => images(new Buffer(png, 'base64')));
            var result = images(
                imgs.map((img) => img.width()).reduce((a, b) => Math.max(a, b)),
                imgs.map((img) => img.height()).reduce((a, b) => a + b));

            var offset = 0;
            imgs.forEach((img) => {
                result.draw(img, 0, offset);
                offset += img.height();
            });
            result.resize(result.width() * data.height / result.height()).save(path.join(outdir, 'screenshot.png'));
            report.screenshots = ['screenshot.png'];

            return { report: report };
        });
}

function sleep(delay) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, delay || 1000);
    });
}

function takeScreenshots() {
    return new Promise((resolve, reject) => {
        function visit(offset, metrics, acc) {
            if (offset < metrics.documentHeight) {
                var offsetAdjustment = metrics.windowHeight;

                // If the size of the screenshot to be taken is smaller than
                // the height of the window, then resize the window...
                var resize = new Promise((resolve, reject) => {
                    var newWindowHeight = Math.min(metrics.maxWindowHeight,
                        // Tabs, etc.
                        (metrics.maxWindowHeight - metrics.windowHeight) +
                        // Height of the last screenshot
                        metrics.documentHeight - offset);

                    var nextWindowHeight = Math.min(metrics.maxWindowHeight,
                        // Tabs, etc.
                        (metrics.maxWindowHeight - metrics.windowHeight) +
                        // Height of the last screenshot
                        metrics.documentHeight - (offset + offsetAdjustment));

                    if (nextWindowHeight > 0 && nextWindowHeight < metrics.minWindowHeight) {
                        var diff = metrics.minWindowHeight - nextWindowHeight;
                        newWindowHeight -= diff;
                        offsetAdjustment -= diff;
                    }

                    console.log(util.format('Resizing window to 1600x%s (document height: %s, window height: %s)', newWindowHeight, metrics.documentHeight, metrics.windowHeight).blue.bold);
                    browser.driver.manage().window().setSize(1600, newWindowHeight);
                    
                    // Give the window some time to resize before continuing
                    sleep().then(resolve);
                });
                
                // Scroll to the current position
                var scroll = resize.then(png => {
                    console.log(util.format('Scrolling to offset %s', offset).blue.bold);
                    return browser.executeScript(util.format('window.scrollTo(0, %s);', offset));
                });

                // Take the screenshot
                var screenshot = scroll.then(sleep).then(() => {
                    console.log(util.format('Taking screenshot', offset).blue.bold);
                    return browser.takeScreenshot();
                });

                // Continue until all screenshots have been taken
                screenshot.then((png) => acc.push(png))
                .then((windowHeight) => visit(offset+offsetAdjustment, metrics, acc));
            } else {
                resolve({ height: metrics.documentHeight, pngs: acc });
            }
        }

        browser.executeScript('return { documentHeight: Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight), windowHeight: window.innerHeight, minWindowHeight: 300, maxWindowHeight: window.outerHeight };')
        .then(metrics => visit(0, metrics, []));
    });
}

function writeScreenShot(filename, data) {
    var stream = fs.createWriteStream(filename);
    stream.write(new Buffer(data, 'base64'));
    stream.end();
}