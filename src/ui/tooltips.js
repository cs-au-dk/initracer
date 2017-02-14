// Internal
var natives = require('../utils/natives.js');

var Opentip = null;

function initializeOpentip(_$) {
    if (!Opentip) {
        Opentip = window.getOpentip(_$);
        Opentip.styles.custom = {
            extends: "alert",
            target: true,
            showOn: 'creation',
            stem: true
        };
    }
}

function highlight(element) {
    element.style.outlineColor = 'red';
    element.style.outlineStyle = 'solid';
    element.style.outlineWidth = '1px';
}

/**
 * Creates a tooltip rooted on `element`.
 * Argument `severe` is optional. If passed, then the element is emphasized.
 */
function createTooltips(descriptors) {
    // Preprocess descriptors
    for (var i = 0; i < descriptors.length; ++i) {
        var descriptor = descriptors[i];
        descriptor.raceIds = {
            ABD: {},
            FIO: {},
            LEHR: {}
        };
        descriptor.raceIds[descriptor.category][descriptor.kind] = [descriptor.raceId];

        for (var j = descriptors.length-1; j > i; --j) {
            var other = descriptors[j];
            if (descriptor.elementId === other.elementId) {
                if (descriptor.raceIds[other.category][other.kind]) {
                    descriptor.raceIds[other.category][other.kind].push(other.raceId);
                } else {
                    descriptor.raceIds[other.category][other.kind] = [other.raceId];
                }
                descriptors.splice(j, 1);
            }
        }

        descriptor.tooltip = [];
        ['ABD', 'FIO', 'LEHR'].forEach(function (category) {
            for (var kind in descriptor.raceIds[category]) {
                if (descriptor.raceIds[category][kind].length) {
                    var ids = descriptor.raceIds[category][kind].join(',');
                    descriptor.tooltip.push(category + ': ' + kind + ' (#' + ids + ')');
                }
            }
        });
    }

    function visit() {
        if (descriptors.length) {
            var { elementId, tooltip } = descriptors.pop();

            try {
                var element = document.querySelector('#' + elementId);
                if (element) {
                    highlight(element);

                    // Create the tooltip for this element
                    new Opentip(element, tooltip.join('<br>'), { style: 'custom', tipJoint: descriptors.length % 2 === 0 ? 'bottom' : 'top' });

                    // Create the tooltips with 50ms delays (the Opentip library seems to fail otherwise)
                    natives.refs.setTimeout.call(window, visit, 50);
                } else {
                    visit();
                }
            } catch (e) {
                visit();
            }
        }
    }

    visit();
}

module.exports = {
    createTooltips: createTooltips,
    highlight: highlight,
    initializeOpentip: initializeOpentip
};
