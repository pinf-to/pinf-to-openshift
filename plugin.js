
const FORCE_TURN = false;
const URL = require("url");
const DNS = require("dns");


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

			function ensureApp (callback) {

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
							ssh: getVar("SSH"),
							aliases: []
						};

						resolvedConfig.app.host = URL.parse(resolvedConfig.app.url).host;
						resolvedConfig.app.hostname = URL.parse(resolvedConfig.app.url).hostname;

						return DNS.lookup(resolvedConfig.app.host, function (err, record) {
							if (err) return callback(err);

							resolvedConfig.app.ip = record;

							return callback(null);
						});
					});
				}

				return checkExisting(callback);
			}

			function ensureAliases (callback) {
				if (
					previousResolvedConfig &&
					previousResolvedConfig.app &&
					previousResolvedConfig.app.aliases
				) {
					// TODO: Ensure alias does in fact still exist by calling URL or other indicator.
					resolvedConfig.app.aliases = previousResolvedConfig.app.aliases;
					return callback(null);
				}
				var waitfor = API.WAITFOR.parallel(callback);
				for (var name in resolvedConfig.openshift.aliases) {
					waitfor(name, function (name, callback) {

						function create (callback) {
							API.console.verbose("Provisioning alias '" + name + "' on OpenShift.");
							return API.runCommands([
								"rhc alias add " + resolvedConfig.openshift.app + " " + name
							], {
								cwd: targetPath
							}, callback);
						}

						function checkExisting (callback, verifyCreated) {
							return API.runCommands([
								"rhc alias list -a " + resolvedConfig.openshift.app
							], {
								cwd: targetPath
							}, function (err, stdout) {
								if (err) return callback(err);
								if (/No aliases associated/.test(stdout)) {
									if (verifyCreated) {
										return callback(new Error("Alias '" + name + "' not found after creating it!"));
									}
									return create(function (err) {
										if (err) return callback(err);
										return checkExisting(callback, true);
									});
								}
								if (new RegExp("^" + API.ESCAPE_REGEXP_COMPONENT(name)).exec(stdout)) {
									resolvedConfig.app.aliases.push(name);
								}
								return callback(null);
							});
						}

						return checkExisting(callback);

					});
				}
				return waitfor();
			}

			return API.Q.denodeify(function (callback) {
				return ensureApp(function (err) {
					if (err) return callback(err);
					return ensureAliases(callback);
				});
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
					// TODO: Do this generically where all external symlinks are inlined.
					'rm -Rf "' + targetPath + '/www/bundles" > /dev/null || true',
					'rsync -a "' + fromPath + '/" "' + targetPath + '/"',
					'rm -Rf */.git **/.git',
					'rm -Rf .gitignore **/.gitignore',
				], {
					cwd: targetPath
				}, function (err) {
					if (err) return callback(err);

					function finalize (callback) {
						return API.runCommands([
							'echo "Commit changes ..."',
							'git add -A',
							'git commit -m "Changes"',
							'echo "Push changes ..."',
							'git push origin master'
						], {
							cwd: targetPath
						}, callback);
					}

					// TODO: Externalize this.
					if (API.FS.existsSync(API.PATH.join(targetPath, "symfony-cmf"))) {
						return API.runCommands([
							'rm -f symfony-cmf/app/bootstrap.php.cache',
							'echo -e "cd $OPENSHIFT_REPO_DIR\nphp \\`find -name build_bootstrap.php\\`" > .openshift/action_hooks/build',
							'chmod +x .openshift/action_hooks/build',
						], {
							cwd: targetPath
						}, function (err) {
							if (err) return callback(err);
							return finalize(callback);
						});
					} else
					if (API.FS.existsSync(API.PATH.join(targetPath, "program.json"))) {

						var descriptor = JSON.parse(API.FS.readFileSync(API.PATH.join(targetPath, "program.json"), "utf8"));

						var runtimePath = API.PATH.join(fromPath, descriptor.boot.runtime);
						descriptor.boot.runtime = "./" + API.PATH.basename(runtimePath);
						API.FS.copySync(runtimePath, API.PATH.join(targetPath, descriptor.boot.runtime));

						delete descriptor.config.sourceHashFile;

						API.FS.outputFileSync(API.PATH.join(targetPath, "program.json"), JSON.stringify(descriptor, null, 4), "utf8");



						descriptor = JSON.parse(API.FS.readFileSync(API.PATH.join(targetPath, "program.rt.json"), "utf8"));

						descriptor.server.bind = "{{env.OPENSHIFT_NODEJS_IP}}";
						descriptor.server.port = "{{env.OPENSHIFT_NODEJS_PORT}}";

						API.FS.outputFileSync(API.PATH.join(targetPath, "program.rt.json"), JSON.stringify(descriptor, null, 4), "utf8");



						// TODO: Do this generically where all external symlinks are inlined.
						var sourcePath = API.FS.realpathSync(API.PATH.join(targetPath, "www/bundles"));
						API.FS.removeSync(API.PATH.join(targetPath, "www/bundles"));
						API.FS.copySync(sourcePath, API.PATH.join(targetPath, "www/bundles"));


						return finalize(callback);
					} else {
						return finalize(callback);
					}
				});
			});
		})();
	}

	return exports;
}
