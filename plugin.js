
const FORCE_TURN = true;

exports.for = function (API) {

	var exports = {};

	var targetPath = API.PATH.join(API.getTargetPath(), "app");

	exports.resolve = function (resolver, config, previousResolvedConfig) {

		return resolver({}).then(function (resolvedConfig) {

			// TODO: Use schema-based validator.
			API.ASSERT(typeof resolvedConfig.openshift.app, "string");
			API.ASSERT(typeof resolvedConfig.openshift.cartridge, "string");
			if (!/^[a-zA-Z0-9]+$/.test(resolvedConfig.openshift.app)) {
				throw new Error("'openshift.name' must contain only alphanumeric characters (a-z, A-Z, or 0-9)");
			}

			if (!API.FS.existsSync(targetPath)) {
				API.FS.mkdirsSync(targetPath);
			}

			function create (callback) {
				return API.runCommands([
					"rhc app create " + resolvedConfig.openshift.app + " " + resolvedConfig.openshift.cartridge
				], {
					cwd: targetPath
				}, callback);
			}

			function checkExisting (callback, verifyCreated) {

				if (previousResolvedConfig && previousResolvedConfig.app) {
					// TODO: Ensure app does in fact still exist by calling URL or other indicator.
					resolvedConfig.app = previousResolvedConfig.app;
					return callback(null);
				}

				return API.runCommands([
					"rhc show-app " + resolvedConfig.openshift.app
				], {
					cwd: targetPath
				}, function (err, stdout) {
					if (err) {
						if (
							err.code == 101 &&
							/Application .+ not found/.test(err.stdout.join("\n"))
						) {
							if (verifyCreated) {
								return callback(new Error("App not found after creating it!"));
							}
							resolvedConfig.app = {};
							return create(function (err) {
								if (err) return callback(err);
								return checkExisting(callback, true);
							});
						}
						return callback(err);
					}

					function getVar (match) {
						var m = null;
						if (typeof match !== "string") {
							m = stdout.match(match);
						} else {
							m = new RegExp(API.ESCAPE_REGEXP_COMPONENT(match) + ":[\\s\\t]*(.+)").exec(stdout);
						}
						if (!m) {
							return "";
						}
						return m[1];
					}

					resolvedConfig.app = {
						url: getVar(/\s@\s(\S*)\s/),
						uuid: getVar(/\s@\s(?:\S*)\s\(uuid:\s([0-9a-z]+)\)/),
						domain: getVar("Domain"),
						gears: getVar("Gears"),
						gitUrl: getVar("Git URL"),
						ssh: getVar("SSH")
					};

					return callback(null);
				});
			}

			return API.Q.denodeify(function (callback) {
				return checkExisting(callback);
			})().then(function () {
				if (FORCE_TURN) {
					resolvedConfig["@forceTurn"] = Date.now();
				}
				return resolvedConfig;
			});
		});
	}

	exports.turn = function (resolvedConfig) {

		return API.Q.denodeify(function (callback) {

			var fromPath = resolvedConfig.sourcePath;

			// TODO: Better copy logic that does not copy git dir.
			if (API.FS.existsSync(API.PATH.join(fromPath, ".git"))) {
				return callback(new Error("Cannot copy '" + fromPath + "' as it contains a '.git' directory. Remove first!"));
			}

			function ensureValidClone (callback) {
				if (API.FS.existsSync(API.PATH.join(targetPath, ".git"))) {
					// TODO: Ensure git repository is tied to openshift app.
					return callback(null);
				}
				API.FS.removeSync(targetPath);
				return API.runCommands([
					'git clone "' + resolvedConfig.app.gitUrl + '" "' + targetPath + '"'
				], callback);
			}

			return ensureValidClone(function (err) {
				if (err) return callback(err);

				return API.runCommands([
					'echo "Copy files ..."',
					'rsync -a "' + fromPath + '/" "' + targetPath + '/"',
					'rm -Rf */.git */*/.git */*/*/.git */*/*/*/.git */*/*/*/*/.git',
					'rm -Rf .gitignore */.gitignore */*/.gitignore */*/*/.gitignore */*/*/*/.gitignore */*/*/*/*/.gitignore',
					'rm -f symfony-cmf/app/bootstrap.php.cache',
					'echo -e "cd $OPENSHIFT_REPO_DIR\nphp \\`find -name build_bootstrap.php\\`" > .openshift/action_hooks/build',
					'chmod +x .openshift/action_hooks/build',
					'echo "Commit changes ..."',
					'git add -A',
					'git commit -m "Changes"',
					'echo "Push changes ..."',
					'git push origin master'
				], {
					cwd: targetPath
				}, callback);
			});
		})();
	}

	return exports;
}
