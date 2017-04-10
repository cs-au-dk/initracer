var app = angular.module('reportApp', ['angular-duration-format', 'ngRoute', '720kb.tooltips']);

app.config(function($routeProvider) {
    $routeProvider
    .when('/', {
        templateUrl: 'templates/summary.html',
        controller: 'SummaryController'
    })
    .when('/access-before-definition', {
        templateUrl: 'templates/summary-access-before-definition.html',
        controller: 'SummaryController'
    })
    .when('/late-event-handler-registration', {
        templateUrl: 'templates/summary-late-event-handler-registration.html',
        controller: 'SummaryController'
    })
    .when('/form-input-overwritten', {
        templateUrl: 'templates/summary-form-input-overwritten.html',
        controller: 'SummaryController'
    })
    .when('/performance', {
        templateUrl: 'templates/summary-performance.html',
        controller: 'SummaryController'
    })
    .when('/:siteId', {
        templateUrl: 'templates/site.html',
        controller: 'SiteController'
    })
    .when('/:siteId/access-before-definition', {
        templateUrl: 'templates/site-access-before-definition.html',
        controller: 'SiteController'
    })
    .when('/:siteId/late-event-handler-registration', {
        templateUrl: 'templates/site-late-event-handler-registration.html',
        controller: 'SiteController'
    })
    .when('/:siteId/form-input-overwritten', {
        templateUrl: 'templates/site-form-input-overwritten.html',
        controller: 'SiteController'
    })
    .otherwise('/');
});

app.filter('groupHasSelectedReport', ['$timeout', function ($timeout) {
    return function (races, $scope) {
        if (!races.__groupBy__) {
            var groups = races
                .map(function (race) {
                    return race.stackTrace.filter($scope.notInitRacerLocation).join('\n');
                })
                .filter(function (stackTrace, i, stackTraces) {
                    return stackTraces.indexOf(stackTrace) === i;
                })
                .map(function (stackTrace) {
                    return {
                        stackTrace: stackTrace,
                        races: races.filter(function (race) {
                            return race.stackTrace.filter($scope.notInitRacerLocation).join('\n') === stackTrace;
                        })
                    };
                })
                .filter(function (group) {
                    return group.races.length > 0 && group.races.some($scope.isReportSelected);
                });

            var result = {};
            groups.forEach(function (group) {
                result[group.stackTrace] = group.races;
            });
            
            Object.defineProperty(races, '__groupBy__', {
                enumerable: false,
                configurable: true,
                writable: false,
                value: result
            });
            $timeout(function () { delete races.__groupBy__; }, 0, false);
        }
        return races.__groupBy__;
    };
}]);

app.filter('sumOfValue', function () {
    return function (data, options) {
        if (angular.isUndefined(data) || angular.isUndefined(options)) {
            return 0;
        }
        var path = options instanceof Array ? options : options.path;
        var computation = options.computation || 'sum';
        var average = !!options.average;
        var excludeEmpty = !!options.excludeEmpty;
        var round = !!options.round;

        var result = 0, processed = 0, nonEmpty = 0;
        angular.forEach(data, function (value) {
            path.forEach(function (key) {
                value = value[key];
            });

            value = parseInt(value);

            ++processed;
            if (value > 0) {
                ++nonEmpty;
            }

            if (computation === 'max') {
                if (value > result) {
                    result = value;
                }
            } else if (computation === 'min') {
                if (processed === 1 || value < result) {
                    result = value;
                }
            } else if (computation === 'sum') {
                result = result + value;
            }
        });

        if (average && result > 0) {
            result = result / (excludeEmpty ? nonEmpty : data.length);
        }
        if (round) {
            result = parseInt(result);
        }
        return result;
    }
});

app.controller('SummaryController', ['$scope', '$rootScope', '$http', '$location', function($scope, $rootScope, $http, $location) {
    $scope.$location = $location;
    $scope.Math = Math;

    $rootScope.sites = [];

    if (!$rootScope.sites.length) {
        $http({ method: 'GET', url: '../out/summary.json' }).then(function (response) {
            $rootScope.sites = Object.values(response.data);
        });
    }

    $scope.excludeHashFromUrl = function (url) {
        if (typeof url === 'string') {
            var idx = url.indexOf('#');
            if (idx >= 0) {
                return url.substring(0, idx);
            }
        }
        return url;
    };

    $scope.siteHasWarning = function (site) {
        return 0 <
            site.formInputOverwrittenRaces.writes.validated +
            site.formInputOverwrittenRaces.blurs.visibleWritableStaticTargetWithLongDelay +
            site.lateEventHandlerRegistrationRaces.user.visibleStaticTargetWithLongDelayWithPreventDefault +
            site.lateEventHandlerRegistrationRaces.system.staticElementTargetWithLongDelay +
            site.accessBeforeDefinitionRaces.user.validated +
            site.accessBeforeDefinitionRaces.system.validated;
    };

    $scope.siteHasNonValidatedABDWarning = function (site) {
        return 0 <
            site.accessBeforeDefinitionRaces.user.failing +
            site.accessBeforeDefinitionRaces.system.failing;
    };

    $scope.siteOnlyHasValidatedABDWarnings = function (site) {
        return $scope.siteHasNonValidatedABDWarning(site) && 0 ===
            (site.accessBeforeDefinitionRaces.user.failing - site.accessBeforeDefinitionRaces.user.validated) +
            (site.accessBeforeDefinitionRaces.system.failing - site.accessBeforeDefinitionRaces.system.validated);
    };

    $scope.siteWithMostABDWarnings = function () {
        var mostSoFar = null;
        $rootScope.sites.forEach(function (site) {
            if (mostSoFar === null ||
                    mostSoFar.accessBeforeDefinitionRaces.user.validated <
                    site.accessBeforeDefinitionRaces.user.validated) {
                mostSoFar = site;
            }
        });
        return mostSoFar;
    };
}]);

app.controller('SiteController', ['$scope', '$rootScope', '$http', '$location', '$routeParams', function($scope, $rootScope, $http, $location, $routeParams) {
    $scope.$location = $location;
    $scope.$routeParams = $routeParams;
    $scope.$scope = $scope;
    $scope.filters = getDefaultFilter();
    $scope.site = $scope.summary = null;

    $rootScope.reports = $rootScope.reports || {};
    if ($rootScope.reports[$routeParams.siteId]) {
        $scope.site = $rootScope.reports[$routeParams.siteId];
    } else {
        $http({ method: 'GET', url: '../out/' + $routeParams.siteId + '/race-report.json' }).then(function (response) {
            $scope.site = $rootScope.reports[$routeParams.siteId] = response.data;
        });
    }

    if ($rootScope.sites && $rootScope.sites.length) {
        $scope.summary = $rootScope.sites.find(function (site) {
            return site.name === $routeParams.siteId;
        });
    } else {
        $http({ method: 'GET', url: '../out/summary.json' }).then(function (response) {
            $rootScope.sites = Object.values(response.data);
            $scope.summary = $rootScope.sites.find(function (site) {
                return site.name === $routeParams.siteId;
            });
        });
    }

    function getDefaultFilter() {
        return {
            isImportant: '!'
        };
    }

    $scope.getNumberOfRacesInTable = function (tableId, notGrouped) {
        if (notGrouped) {
            return document.querySelectorAll('#' + tableId + ' td:first-child').length;
        }
        return document.querySelectorAll('#' + tableId + ' td:first-child div').length;
    };

    $scope.getNumberOfGroupsInTable = function (tableId) {
        return document.querySelectorAll('#' + tableId + ' td:first-child').length;
    };

    $scope.breakLines = function (text) {
        return text.replace(/\n/g, "<br />");
    };

    $scope.isAccessSelected = function (access) {
        if (typeof access.throwsAfterLoad === 'boolean') {
            if ($scope.filters.throwsAfterLoad === 'Yes' && !access.throwsAfterLoad) {
                return false;
            }
            if ($scope.filters.throwsAfterLoad === 'No' && access.throwsAfterLoad) {
                return false;
            }
        }
        if ($scope.filters.isAssigned === 'Yes' && !access.isAssigned && !access.isPrefixAssigned) {
            return false;
        }
        if ($scope.filters.isAssigned === 'No' && (access.isAssigned || access.isPrefixAssigned)) {
            return false;
        }
        if ($scope.filters.isLikelyBrowserDependent === 'Yes' && !access.isLikelyBrowserDependent) {
            return false;
        }
        if ($scope.filters.isLikelyBrowserDependent === 'No' && access.isLikelyBrowserDependent) {
            return false;
        }
        return true;
    };

    $scope.isReportSelected = function (race) {
        if ($scope.site === null || typeof race !== 'object') {
            return false;
        }

        // Filters on all tabs
        if ($scope.filters.isImportant === '!' && !race.important) {
            return false;
        }

        var visibility = race.isVisible || race.isTargetVisible;
        if (typeof visibility === 'object') {
            if ($scope.filters.isVisible === 'Yes' && !visibility.jQuery && !visibility.visibilityjs) {
                return false;
            }
            if ($scope.filters.isVisible === 'No' && visibility.jQuery && visibility.visibilityjs) {
                return false;
            }
        }

        // Access-Before-Definition filters
        if ($location.$$path.indexOf('/access-before-definition') >= 0) {
            if (race.accesses instanceof Array && race.accesses.length > 0 && !race.accesses.some($scope.isAccessSelected)) {
                return false;
            }
            if (typeof race.isListenerReadingParameter === 'boolean') {
                if ($scope.filters.isListenerReadingParameter === 'Yes' && !race.isListenerReadingParameter) {
                    return false;
                }
                if ($scope.filters.isListenerReadingParameter === 'No' && race.isListenerReadingParameter) {
                    return false;
                }
            }
        }

        // Late-Event-Handler-Registration filters
        if ($location.$$path.indexOf('/late-event-handler-registration') >= 0) {
            if (typeof race.name === 'string') {
                if ($scope.filters.documentRegistration === 'Yes' && race.name !== 'document') {
                    return false;
                }
                if ($scope.filters.documentRegistration === 'No' && race.name === 'document') {
                    return false;
                }
            }
            if (typeof race.callsPreventDefault === 'boolean') {
                if ($scope.filters.callsPreventDefault === 'Yes' && !race.callsPreventDefault) {
                    return false;
                }
                if ($scope.filters.callsPreventDefault === 'No' && race.callsPreventDefault) {
                    return false;
                }
            }
        }

        // Form-Input-Overwritten filters
        if ($location.$$path.indexOf('/form-input-overwritten') >= 0) {
            if (typeof race.isReadOnly === 'boolean') {
                if ($scope.filters.isReadOnly === 'Yes' && !race.isReadOnly) {
                    return false;
                }
                if ($scope.filters.isReadOnly === 'No' && race.isReadOnly) {
                    return false;
                }
            }
        }

        // Late-Event-Handler-Registration and Form-Input-Overwritten filters
        if ($location.$$path.indexOf('/late-event-handler-registration') >= 0 || $location.$$path.indexOf('/form-input-overwritten') >= 0) {
            if (typeof race.isLongDelay === 'boolean') {
                if ($scope.filters.isLongDelay === 'Yes' && !race.isLongDelay) {
                    return false;
                }
                if ($scope.filters.isLongDelay === 'No' && race.isLongDelay) {
                    return false;
                }
            }
        }

        return true;
    };

    $scope.setFilters = function (enable) {
        if (enable) {
            $scope.filters = getDefaultFilter();
        } else {
            $scope.filters = {};
        }
    };

    $scope.notInitRacerLocation = function (line) {
        return line.indexOf('at InitRacer.') < 0 &&
            line.indexOf('at AccessBeforeDefinitionRaceDetector.') < 0 &&
            line.indexOf('at FormInputRaceDetector.') < 0 &&
            line.indexOf('at LateEventHandlerRegistrationRaceDetector.') < 0 &&
            line.indexOf('at enqueueEventHandlerAnalysis') < 0 &&
            line.indexOf('at Object.stackTrace') < 0 &&
            line.indexOf('at notifyListeners') < 0;
    };
}]);
