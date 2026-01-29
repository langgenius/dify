eslint [options] file.js [file.js] [dir]

Basic configuration:
--no-config-lookup Disable look up for eslint.config.js
-c, --config path::String Use this configuration instead of eslint.config.js, eslint.config.mjs, or eslint.config.cjs
--inspect-config Open the config inspector with the current configuration
--ext [String] Specify additional file extensions to lint
--global [String] Define global variables
--parser String Specify the parser to be used
--parser-options Object Specify parser options

Specify Rules and Plugins:
--plugin [String] Specify plugins
--rule Object Specify rules

Fix Problems:
--fix Automatically fix problems
--fix-dry-run Automatically fix problems without saving the changes to the file system
--fix-type Array Specify the types of fixes to apply (directive, problem, suggestion, layout)

Ignore Files:
--no-ignore Disable use of ignore files and patterns
--ignore-pattern [String] Patterns of files to ignore

Use stdin:
--stdin Lint code provided on <STDIN> - default: false
--stdin-filename String Specify filename to process STDIN as

Handle Warnings:
--quiet Report errors only - default: false
--max-warnings Int Number of warnings to trigger nonzero exit code - default: -1

Output:
-o, --output-file path::String Specify file to write report to
-f, --format String Use a specific output format - default: stylish
--color, --no-color Force enabling/disabling of color

Inline configuration comments:
--no-inline-config Prevent comments from changing config or rules
--report-unused-disable-directives Adds reported errors for unused eslint-disable and eslint-enable directives
--report-unused-disable-directives-severity String Chooses severity level for reporting unused eslint-disable and eslint-enable directives - either: off, warn, error, 0, 1, or 2
--report-unused-inline-configs String Adds reported errors for unused eslint inline config comments - either: off, warn, error, 0, 1, or 2

Caching:
--cache Only check changed files - default: false
--cache-file path::String Path to the cache file. Deprecated: use --cache-location - default: .eslintcache
--cache-location path::String Path to the cache file or directory
--cache-strategy String Strategy to use for detecting changed files in the cache - either: metadata or content - default: metadata

Suppressing Violations:
--suppress-all Suppress all violations - default: false
--suppress-rule [String] Suppress specific rules
--suppressions-location path::String Specify the location of the suppressions file
--prune-suppressions Prune unused suppressions - default: false
--pass-on-unpruned-suppressions Ignore unused suppressions - default: false

Miscellaneous:
--init Run config initialization wizard - default: false
--env-info Output execution environment information - default: false
--no-error-on-unmatched-pattern Prevent errors when pattern is unmatched
--exit-on-fatal-error Exit with exit code 2 in case of fatal error - default: false
--no-warn-ignored Suppress warnings when the file list includes ignored files
--pass-on-no-patterns Exit with exit code 0 in case no file patterns are passed
--debug Output debugging information
-h, --help Show help
-v, --version Output the version number
--print-config path::String Print the configuration for the given file
--stats Add statistics to the lint report - default: false
--flag [String] Enable a feature flag
--mcp Start the ESLint MCP server
--concurrency Int|String Number of linting threads, auto to choose automatically, off for no multithreading - default: off
