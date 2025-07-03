# editorconfig-checker

<a href="https://www.buymeacoffee.com/mstruebing" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: 41px !important;width: 174px !important;box-shadow: 0px 3px 2px 0px rgba(190, 190, 190, 0.5) !important;-webkit-box-shadow: 0px 3px 2px 0px rgba(190, 190, 190, 0.5) !important;" ></a>

[![ci](https://github.com/editorconfig-checker/editorconfig-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/editorconfig-checker/editorconfig-checker/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/editorconfig-checker/editorconfig-checker/branch/main/graph/badge.svg)](https://codecov.io/gh/editorconfig-checker/editorconfig-checker)
[![Hits-of-Code](https://hitsofcode.com/github/editorconfig-checker/editorconfig-checker?branch=main&label=Hits-of-Code)](https://hitsofcode.com/github/editorconfig-checker/editorconfig-checker/view?branch=main&label=Hits-of-Code)
[![Go Report Card](https://goreportcard.com/badge/github.com/editorconfig-checker/editorconfig-checker/v3)](https://goreportcard.com/report/github.com/editorconfig-checker/editorconfig-checker/v3)<!-- x-release-please-major -->

![Logo](docs/logo.png)

1. [What?](#what)
2. [Quickstart](#quickstart)
3. [Installation](#installation)
4. [Usage](#usage)
5. [Configuration](#configuration)
6. [Excluding](#excluding)
   1. [Excluding Lines](#excluding-lines)
   2. [Excluding Blocks](#excluding-blocks)
   3. [Excluding Paths](#excluding-paths)
      1. [Inline](#inline)
      2. [Default Excludes](#default-excludes)
      3. [Ignoring Default Excludes](#ignoring-default-excludes)
      4. [Manually Excluding](#manually-excluding)
         1. [via configuration](#via-configuration)
         2. [via arguments](#via-arguments)
7. [Docker](#docker)
8. [Continuous Integration](#continuous-integration)
9. [Support](#support)
10. [Contributing](#contributing)
11. [Semantic Versioning Policy](#semantic-versioning-policy)

## What?

![Example Screenshot](docs/screenshot.png)

This is a tool to check if your files consider your `.editorconfig` rules.
Most tools—like linters, for example—only test one filetype and need an extra configuration.
This tool only needs your `.editorconfig` to check all files.

If you don't know about editorconfig already you can read about it here: [editorconfig.org](https://editorconfig.org/).

Currently, implemented editorconfig features are:

- `end_of_line`
- `insert_final_newline`
- `trim_trailing_whitespace`
- `indent_style`
- `indent_size`
- `max_line_length`

Unsupported features are:

- `charset`

## Quickstart

<!-- x-release-please-start-version -->
```shell
VERSION="v3.3.0"
OS="linux"
ARCH="amd64"
curl -O -L -C - https://github.com/editorconfig-checker/editorconfig-checker/releases/download/$VERSION/ec-$OS-$ARCH.tar.gz && \
tar xzf ec-$OS-$ARCH.tar.gz && \
./bin/ec-$OS-$ARCH
```
<!-- x-release-please-end -->

## Installation

Grab a binary from the [release page](https://github.com/editorconfig-checker/editorconfig-checker/releases).

If you have go installed you can run `go get github.com/editorconfig-checker/editorconfig-checker/v3` <!-- x-release-please-major -->
and run `make build` inside the project folder.
This will place a binary called `ec` into the `bin` directory.

If you are using Arch Linux, you can use [pacman](https://wiki.archlinux.org/title/Pacman) to install from [extra repository](https://archlinux.org/packages/extra/x86_64/editorconfig-checker/):

```shell
pacman -S editorconfig-checker
```

Also, development (VCS) package is available in the [AUR](https://aur.archlinux.org/packages/editorconfig-checker-git):

```shell
# <favourite-aur-helper> <install-command> editorconfig-checker-git

# i.e.
paru -S editorconfig-checker-git
```

If Go 1.16 or greater is installed, you can also install it globally via `go install`:

```shell
go install github.com/editorconfig-checker/editorconfig-checker/v3/cmd/editorconfig-checker@latest
```

## Usage

```txt
USAGE:
  -config string
        config
  -debug
        print debugging information
  -disable-end-of-line
        disables the trailing whitespace check
  -disable-indent-size
        disables only the indent-size check
  -disable-indentation
        disables the indentation check
  -disable-insert-final-newline
        disables the final newline check
  -disable-trim-trailing-whitespace
        disables the trailing whitespace check
  -dry-run
        show which files would be checked
  -exclude string
        a regex which files should be excluded from checking - needs to be a valid regular expression
  -format
        specifies the output format, see "Formats" below for more information
  -h    print the help
  -help
        print the help
  -ignore-defaults
        ignore default excludes
  -init
        creates an initial configuration
  -no-color
        disables printing color
  -color
        enables printing color
  -v    print debugging information
  -verbose
        print debugging information
  -version
        print the version number
```

If you run this tool from a repository root it will check all files which are added to the git repository and are text files. If the tool isn't able to determine a file type it will be added to be checked too.

If you run this tool from a normal directory it will check all files which are text files. If the tool isn't able to determine a file type it will be added to be checked too.

### Formats

The following output formats are supported:

- **default**: Plain text, human readable output.<br/>
  ```text
  <file>:
    <startingLine>-<endLine>: <message>
  ```
- **gcc**: GCC compatible output. Useful for editors that support compiling and showing syntax errors. <br/>
  `<file>:<line>:<column>: <type>: <message>`
- **github-actions**: The format used by GitHub Actions <br/>
  `::error file=<file>,line=<startingLine>,endLine=<endingLine>::<message>`
- **codeclimate**: The [Code Climate](https://github.com/codeclimate/platform/blob/master/spec/analyzers/SPEC.md#data-types) json format used for [custom quality reports](https://docs.gitlab.com/ee/ci/testing/code_quality.html#implement-a-custom-tool) in GitLab CI
  ```json
  [
    {
      "check_name": "editorconfig-checker",
      "description": "Wrong indent style found (tabs instead of spaces)",
      "fingerprint": "e87a958a3960d60a11d4b49c563cccd2",
      "severity": "minor",
      "location": {
        "path": ".vscode/extensions.json",
        "lines": {
          "begin": 2,
          "end": 2
        }
      }
    }
  ]
  ```

## Configuration

The configuration is done via arguments or it will take the first config file found with the following file names:

- `.editorconfig-checker.json`
- `.ecrc` (deprecated filename, soon unsupported)

A sample configuration file can look like this and will be used from your current working directory if not specified via the `--config` argument:

```json
{
  "Verbose": false,
  "Debug": false,
  "IgnoreDefaults": false,
  "SpacesAfterTabs": false,
  "NoColor": false,
  "Exclude": [],
  "AllowedContentTypes": [],
  "PassedFiles": [],
  "Disable": {
    "EndOfLine": false,
    "Indentation": false,
    "IndentSize": false,
    "InsertFinalNewline": false,
    "TrimTrailingWhitespace": false,
    "MaxLineLength": false
  }
}
```

You can set any of the options under the `"Disable"` section to `true` to disable those particular checks.

You could also specify command line arguments, and they will get merged with the configuration file. The command line arguments have a higher precedence than the configuration.

You can create a configuration with the `init`-flag. If you specify a `config`-path it will be created there.

By default, the allowed_content_types are:

1. `text/` (matches `text/plain`, `text/html`, etc.)
1. `application/ecmascript`
1. `application/json`
1. `application/x-ndjson`
1. `application/xml`
1. `+json` (matches `application/geo+json`, etc.)
1. `+xml` (matches `application/rss+xml`, etc.)
1. `application/octet-stream`

`application/octet-stream` is needed as a fallback when no content type could be determined. You can add additional accepted content types with the `allowed_content_types` key. But the default ones don't get removed.

## Excluding

### Excluding Lines

You can exclude single lines inline. To do that you need a comment on that line that says: `editorconfig-checker-disable-line`.

```javascript
const myTemplateString = `
  first line
     wrongly indented line because it needs to be` // editorconfig-checker-disable-line
```

Alternatively, you can use `editorconfig-checker-disable-next-line` to skip the line that comes after this comment.
This modifier is present to improve readability, or because your sometimes have no other choice because of your own/language constraints.

```javascript
// editorconfig-checker-disable-next-line used because blah blah blah what ever the reason blah
const myTemplateString = `a line that is (...) longer (...) than ... usual` // or with a very long inline comment
```

Please note that using `editorconfig-checker-disable-next-line` has only an effect on the next line, so it will report if the line where you added the modifier doesn't comply.

### Excluding Blocks

To temporarily disable all checks, add a comment containing `editorconfig-checker-disable`. Re-enable with a comment containing `editorconfig-checker-enable`

```javascript
// editorconfig-checker-disable
const myTemplateString = `
  first line
     wrongly indented line because it needs to be
`
// editorconfig-checker-enable
```

### Excluding Paths

You can exclude paths from being checked in several ways:

- ignoring a file by documenting it inside the to-be-excluded file
- adding a regex matching the path to the [configuration file](#configuration)
- passing a regex matching the path as argument to `--exclude`

All these excludes are used in addition to the [default excludes](#default-excludes), unless you [opt out of them](#ignoring-default-excludes).

If you want to see which files would be checked without checking them you can pass the `--dry-run` flag.

Note that while `--dry-run` might output absolute paths, the regular expression you write must match the filenames using relative paths from where editorconfig-checker is used. This becomes especially relevant if you need to anchor your regular expression in order to only match files in the top level your checked directory.

Additionally, paths will be normalized to Unix style before matching against the regex list happens. As a result you don't have to write `[\\/]` to account for Windows and Unix path styles but can just use `/` instead.

#### Inline

If you want to exclude a file inline you need a comment on the first line of the file that contains: `editorconfig-checker-disable-file`

```haskell
-- editorconfig-checker-disable-file
add :: Int -> Int -> Int
add x y =
  let result = x + y -- falsy indentation would not report
  in result -- falsy indentation would not report
```

#### Default Excludes

If you choose to [ignore them](#ignoring-default-excludes), these paths are excluded automatically:

```txt
// source control related files and folders
"\\.git/",
"\\.jj/",
// package manager, generated, & lock files
// Cargo (Rust)
"Cargo\\.lock$",
// Composer (PHP)
"composer\\.lock$",
// RubyGems (Ruby)
"Gemfile\\.lock$",
// Go Modules (Go)
"go\\.(mod|sum)$",
// Gradle (Java)
"gradle/wrapper/gradle-wrapper\\.properties$",
"gradlew(\\.bat)?$",
"(buildscript-)?gradle\\.lockfile?$",
// Maven (Java)
"\\.mvn/wrapper/maven-wrapper\\.properties$",
"\\.mvn/wrapper/MavenWrapperDownloader\\.java$",
"mvnw(\\.cmd)?$",
// NodeJS
"/node_modules/",
// npm (NodeJS)
"npm-shrinkwrap\\.json$",
"package-lock\\.json$",
// pip (Python)
"Pipfile\\.lock$",
// Poetry (Python)
"poetry\\.lock$",
// pnpm (NodeJS)
"pnpm-lock\\.yaml$",
// Terraform & OpenTofu
"\\.terraform\\.lock\\.hcl$",
// uv (Python)
"uv\\.lock$",
// yarn (NodeJS)
"\\.pnp\\.c?js$",
"\\.pnp\\.loader\\.mjs$",
"\\.yarn/",
"yarn\\.lock$",
// font files
"\\.eot$",
"\\.otf$",
"\\.ttf$",
"\\.woff2?$",
// image & video formats
"\\.avif$",
"\\.gif$",
"\\.ico$",
"\\.jpe?g$",
"\\.mp4$",
"\\.p[bgnp]m$",
"\\.png$",
"\\.svg$",
"\\.tiff?$",
"\\.webp$",
"\\.wmv$",
// other binary or container formats
"\\.bak$",
"\\.bin$",
"\\.docx?$",
"\\.exe$",
"\\.pdf$",
"\\.snap$",
"\\.xlsx?$",
// archive formats
"\\.7z$",
"\\.bz2$",
"\\.gz$",
"\\.jar$",
"\\.tar$",
"\\.tgz$",
"\\.war$",
"\\.zip$",
// log & (git) patch files
"\\.log$",
"\\.patch$",
// generated or minified CSS and JavaScript files
"\\.(css|js)\\.map$",
"min\\.(css|js)$",
```

#### Ignoring Default Excludes

If you either set `IgnoreDefaults` to `true` or pass the `-ignore-defaults` commandline switch, the [default excludes](#default-excludes) will be ignored entirely.

#### Manually Excluding

##### via configuration

In your [configuration file](#configuration) you can exclude files with the `"exclude"` key which takes an array of regular expressions.
This will get merged with the default excludes (if not [ignored](#ignoring-default-excludes)). You should remember to escape your regular expressions correctly.

A [configuration file](#configuration) which would ignore all test files and all Markdown files can look like this:

```json
{
  "Verbose": false,
  "IgnoreDefaults": false,
  "Exclude": ["testfiles", "\\.md$"],
  "SpacesAfterTabs": false,
  "Disable": {
    "EndOfLine": false,
    "Indentation": false,
    "IndentSize": false,
    "InsertFinalNewline": false,
    "TrimTrailingWhitespace": false,
    "MaxLineLength": false
  }
}
```

##### via arguments

If you want to play around how the tool would behave you can also pass the `--exclude` argument to the binary. This will accept a regular expression as well. The argument given will be added to the excludes as defined by your [configuration file](#configuration) (respecting both its [`Exclude`](#via-configuration) and [`IgnoreDefaults`](#ignoring-default-excludes) settings).

For example: `ec --exclude node_modules`

## Docker

You are able to run this tool inside a Docker container.
To do this you need to have Docker installed and run this command in your repository root which you want to check:
`docker run --rm --volume=$PWD:/check mstruebing/editorconfig-checker`

Docker Hub: [mstruebing/editorconfig-checker](https://hub.docker.com/r/mstruebing/editorconfig-checker)

## Continuous Integration

### Mega-Linter

Instead of installing and configuring `editorconfig-checker` and all other linters in your project CI workflows (GitHub Actions & others), you can use [Mega-Linter](https://megalinter.io/latest/) which does all that for you with a single [assisted installation](https://megalinter.io/latest/install-assisted/).

Mega-Linter embeds [editorconfig-checker](https://megalinter.io/latest/descriptors/editorconfig_editorconfig_checker/) by default in all its [flavors](https://megalinter.io/latest/flavors/), meaning that it will be run at each commit or Pull Request to detect any issue related to `.editorconfig`.

If you want to use only `editorconfig-checker` and not the 70+ other linters, you can use the following `.mega-linter.yml` configuration file:

```yaml
ENABLE:
  - EDITORCONFIG
```

### GitLab CI

The [ss-open/ci/recipes project](https://gitlab.com/ss-open/ci/recipes) offers a ready to use lint job integrating editorconfig-checker.

- Main documentation: <https://gitlab.com/ss-open/ci/recipes/-/blob/main/README.md>
- Editorconfig job specific documentation: <https://gitlab.com/ss-open/ci/recipes/-/blob/main/stages/lint/editorconfig/README.md>

## Support

If you have any questions, suggestions, need a wrapper for a programming language or just want to chat join #editorconfig-checker on freenode(IRC).
If you don't have an IRC-client set up you can use the [freenode webchat](https://webchat.freenode.net/?channels=editorconfig-checker).

## Contributing

Anyone can help to improve the project, submit a Feature Request, a bug report or even correct a spelling mistake.

The steps to contribute can be found in the [CONTRIBUTING.md](./CONTRIBUTING.md) file.

## Semantic Versioning Policy

**editorconfig-checker** adheres to [Semantic Versioning](https://semver.org/) for releases.

However, as it is a code quality tool, it's not always clear when a minor or major version bump occurs. The following rules are used to determine the version bump:

- Patch release (1.0.x -> 1.0.y)
  - Updates to output formats (error messages, logs, ...).
  - Performance improvements which doesn't affect behavior.
  - Build process changes (e.g., updating dependencies, updating `Dockerfile`, ...).
  - Reverts (reverting a previous commit).
  - Bug fixes which result in **editorconfig-checker** reporting less linting errors (removing "false-positive" linting errors).
- Minor release (1.x.0 -> 1.y.0)
  - Adding new [configuration options](#configuration), including new CLI flags.
  - Adding new [path to exclude by default](#default-excludes).
  - Adding new [output formats](#formats).
  - Supporting a new [editorconfig](https://editorconfig.org/) property (e.g: `insert_final_newline`, `indent_size`, ...).
  - Any new feature which doesn't break existing behavior.
- Major release (x.0.0 -> y.0.0)
  - Removal of a [configuration](#configuration) option.
  - Removal of an [output format](#formats).
  - Removal of a [path to exclude by default](#default-excludes).
  - Removal of support for an [editorconfig](https://editorconfig.org/) property.
  - Bug fixes, which result in **editorconfig-checker** reporting more linting errors, because the previous behavior was incorrect according to the [editorconfig specification](https://editorconfig.org/).
