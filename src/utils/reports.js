function isFromSameRegistration(report1, report2) {
    if (report1.name !== report2.name ||
            report1.type !== report2.type ||
            report1.kind !== report2.kind ||
            report1.listener.hash !== report2.listener.hash ||
            report1.listener.characters !== report2.listener.characters ||
            report1.isTargetStaticElement !== report2.isTargetStaticElement ||
            report1.isTargetElement !== report2.isTargetElement) {
        return false;
    }
    if (report1.isTargetElement && (
            report1.isTargetVisible.jQuery !== report2.isTargetVisible.jQuery ||
            report1.isTargetVisible.visibilityjs !== report2.isTargetVisible.visibilityjs)) {
        return false;
    }
    if (report1.isTargetStaticElement && (
            report1.location.line !== report2.location.line ||
            report1.location.col !== report2.location.col)) {
        return false;
    }
    return true;
}

module.exports = {
	isFromSameRegistration: isFromSameRegistration
};
