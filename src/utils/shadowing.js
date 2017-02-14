var shadows = new Map();

function getShadow(o) {
	var shadow = shadows.get(o);
	if (!shadow) {
		shadow = {};
		shadows.set(o, shadow);
	}
	return shadow;
}

module.exports = {
	getShadow: getShadow
};