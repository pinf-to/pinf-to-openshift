
exports.for = function (API) {

	var exports = {};

	exports.resolve = function (resolver, config, previousResolvedConfig) {

		return resolver({}).then(function (resolvedConfig) {

			return resolvedConfig;
		});
	}

	exports.turn = function (resolvedConfig) {


console.log("TURNING PINF TO OPENSHIFT", resolvedConfig);


	}

	return exports;
}
