# Changelog

## [3.3.0](https://github.com/editorconfig-checker/editorconfig-checker/compare/v3.2.1...v3.3.0) (2025-05-07)


### Features

* add `.jj` (Jujutsu) directory to default exclude list ([#458](https://github.com/editorconfig-checker/editorconfig-checker/issues/458)) ([ac903a0](https://github.com/editorconfig-checker/editorconfig-checker/commit/ac903a0a7f5506a80b3c5d2e76584b5e277b896a))
* update default paths to exclude ([#462](https://github.com/editorconfig-checker/editorconfig-checker/issues/462)) ([84c5c55](https://github.com/editorconfig-checker/editorconfig-checker/commit/84c5c5579e96a9601f1b0ce51fec66257ceb0b24))


### Bug Fixes

* skip correct number of errors when consolidating errors ([#464](https://github.com/editorconfig-checker/editorconfig-checker/issues/464)) ([8c695f5](https://github.com/editorconfig-checker/editorconfig-checker/commit/8c695f5ef82063d657796dfc0b58e35b022d4b93))

## [3.2.1](https://github.com/editorconfig-checker/editorconfig-checker/compare/v3.2.0...v3.2.1) (2025-03-15)


### Bug Fixes

* check for exclusion before MIME type ([#447](https://github.com/editorconfig-checker/editorconfig-checker/issues/447)) ([cd9976b](https://github.com/editorconfig-checker/editorconfig-checker/commit/cd9976ba25738a02a2130a7fc5e729ed9d6b7251))
* empty format in the config file should be treated as Default ([#448](https://github.com/editorconfig-checker/editorconfig-checker/issues/448)) ([f8799d0](https://github.com/editorconfig-checker/editorconfig-checker/commit/f8799d0915e6c7a3c82941c14b5bafcf472283cf)), closes [#430](https://github.com/editorconfig-checker/editorconfig-checker/issues/430)
* **test:** make TestGetRelativePath work under Darwin ([#445](https://github.com/editorconfig-checker/editorconfig-checker/issues/445)) ([d956561](https://github.com/editorconfig-checker/editorconfig-checker/commit/d95656138c991c47847015902c75f46aeccb8d06))
* **test:** support running our test suite under `-trimpath`, closes [#397](https://github.com/editorconfig-checker/editorconfig-checker/issues/397) ([#439](https://github.com/editorconfig-checker/editorconfig-checker/issues/439)) ([fc78406](https://github.com/editorconfig-checker/editorconfig-checker/commit/fc78406ae4d64dc63256c5b37db61b770bf5e436))
* **test:** we no longer need -ldflags at all ([#444](https://github.com/editorconfig-checker/editorconfig-checker/issues/444)) ([9ffcae2](https://github.com/editorconfig-checker/editorconfig-checker/commit/9ffcae2b7d984c6bf48fde83aaf55ab8962a927a))

## [3.2.0](https://github.com/editorconfig-checker/editorconfig-checker/compare/v3.1.2...v3.2.0) (2025-01-25)


### Features

* add support for env var NO_COLOR ([#429](https://github.com/editorconfig-checker/editorconfig-checker/issues/429)) ([9135f53](https://github.com/editorconfig-checker/editorconfig-checker/commit/9135f531e762ad4c02f4bf45f03888771773da56))
* only output "0 errors found" when verbose output is enabled ([#423](https://github.com/editorconfig-checker/editorconfig-checker/issues/423)) ([1d29a8b](https://github.com/editorconfig-checker/editorconfig-checker/commit/1d29a8b16b4cde8d46f80db29e60330c5bd16095))


### Bug Fixes

* improve default excludes ([#427](https://github.com/editorconfig-checker/editorconfig-checker/issues/427)) ([d0cbd25](https://github.com/editorconfig-checker/editorconfig-checker/commit/d0cbd250caa46a07994b6161ccf2bb4910571a23))

## [3.1.2](https://github.com/editorconfig-checker/editorconfig-checker/compare/v3.1.1...v3.1.2) (2025-01-10)


### Bug Fixes

* provide both .tar.gz as well as .zip archives ([#416](https://github.com/editorconfig-checker/editorconfig-checker/issues/416)) ([00e9890](https://github.com/editorconfig-checker/editorconfig-checker/commit/00e9890847982b2503ec3a11ff539bf2ac4c34c6)), closes [#415](https://github.com/editorconfig-checker/editorconfig-checker/issues/415)

## [3.1.1](https://github.com/editorconfig-checker/editorconfig-checker/compare/v3.1.0...v3.1.1) (2025-01-08)


### Bug Fixes

* dockerfile expected binary at /, not /usr/bin/ [#410](https://github.com/editorconfig-checker/editorconfig-checker/issues/410) ([#411](https://github.com/editorconfig-checker/editorconfig-checker/issues/411)) ([2c82197](https://github.com/editorconfig-checker/editorconfig-checker/commit/2c821979c0b3ea291f65ec813cae3fa265603528))

## [3.1.0](https://github.com/editorconfig-checker/editorconfig-checker/compare/v3.0.3...v3.1.0) (2025-01-06)


### Features

* add zip version when compressing all binaries ([#321](https://github.com/editorconfig-checker/editorconfig-checker/issues/321)) ([#362](https://github.com/editorconfig-checker/editorconfig-checker/issues/362)) ([f1bb625](https://github.com/editorconfig-checker/editorconfig-checker/commit/f1bb625f2553952d4d8c72e3f97d17417f0c1ef7))
* consolidate adjacent error messages ([#360](https://github.com/editorconfig-checker/editorconfig-checker/issues/360)) ([cf4ae1c](https://github.com/editorconfig-checker/editorconfig-checker/commit/cf4ae1ccede331b2aa1b115f1de5257737de7eef))
* editorconfig-checker-disable-next-line ([#363](https://github.com/editorconfig-checker/editorconfig-checker/issues/363)) ([6116ec6](https://github.com/editorconfig-checker/editorconfig-checker/commit/6116ec6685b33652e9e25def9b8897ed4b015c7d))
* provide Codeclimate compatible report fromat ([#367](https://github.com/editorconfig-checker/editorconfig-checker/issues/367)) ([282c315](https://github.com/editorconfig-checker/editorconfig-checker/commit/282c315bd1c48f49cc1328de36e2ba4433c50249))
* support `.editorconfig-checker.json` config ([#375](https://github.com/editorconfig-checker/editorconfig-checker/issues/375)) ([cb0039c](https://github.com/editorconfig-checker/editorconfig-checker/commit/cb0039cfe68a11139011bcffe84b8ff62b3209bb))


### Bug Fixes

* actually use the correct end marker ([#405](https://github.com/editorconfig-checker/editorconfig-checker/issues/405)) ([3c03499](https://github.com/editorconfig-checker/editorconfig-checker/commit/3c034994cba21db7babd33672a0d26184ff88255))
* add `.ecrc` deprecation warning ([#389](https://github.com/editorconfig-checker/editorconfig-checker/issues/389)) ([d33b81c](https://github.com/editorconfig-checker/editorconfig-checker/commit/d33b81cc71c2eb740dd3e1c00f07dbc430b89087))
* this release-please marker ([#403](https://github.com/editorconfig-checker/editorconfig-checker/issues/403)) ([617c6d4](https://github.com/editorconfig-checker/editorconfig-checker/commit/617c6d44b5a8668de16bf67038dd5930e01c074e))
* typo in config, `SpacesAftertabs` =&gt; `SpacesAfterTabs` ([#386](https://github.com/editorconfig-checker/editorconfig-checker/issues/386)) ([25e3542](https://github.com/editorconfig-checker/editorconfig-checker/commit/25e3542ee45b0bd5cbdd450ba8eebee6ad3bba43))
