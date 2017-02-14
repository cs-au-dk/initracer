var anchor4 = document.getElementById('my-anchor-4');
anchor4.addEventListener('click', function (e) {
    indirection4a(e);
}, false);

function indirection4a(e) {
    indirection4b(e);
}

function indirection4b(e) {
	e.preventDefault();
}