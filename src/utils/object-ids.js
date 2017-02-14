var ids = new Map();
var objects = [];

function getId(o) {
	if (!ids.has(o)) {
		ids.set(o, objects.length);
		objects.push(o);
	}
	return ids.get(o);
}

function getObjectById(id) {
	if (typeof id !== 'number' || id >= objects.length) {
		throw new Error('No such object');
	}
	return objects[id];
}

module.exports = {
	getId: getId,
	getObjectById: getObjectById
};
