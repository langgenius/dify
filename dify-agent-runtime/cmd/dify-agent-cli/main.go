// dify-agent-cli is the Go replacement for the Python dify-agent CLI.
// It communicates with the Agent Stub server via HTTP or gRPC to provide
// connect, file, drive, and config operations inside the sandbox container.
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/langgenius/dify/dify-agent-runtime/internal/agentcli"
	"github.com/spf13/cobra"
)

// knownRootCommands mirrors the Python CLI's _KNOWN_ROOT_COMMANDS. Anything else
// on the command line is treated as argv forwarded to an implicit connect.
var knownRootCommands = map[string]struct{}{
	"config":  {},
	"connect": {},
	"drive":   {},
	"file":    {},
}

func main() {
	if err := runCLI(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "dify-agent: %v\n", err)
		os.Exit(1)
	}
}

//go:generate sh -c "go run . __dump-cli-help > ../../../dify-agent/src/dify_agent/layers/_agent_cli_help.json"

func runCLI(args []string) error {
	// Hidden developer intercept: emit the JSON help snapshot from the cobra
	// tree. Not registered as a cobra command, so the visible command surface
	// stays identical to the Python CLI. See dumphelp.go.
	if len(args) == 1 && args[0] == "__dump-cli-help" {
		return dumpCLIHelp(os.Stdout)
	}

	// `connect` forwards its argv verbatim, so bypass flag parsing unless the
	// user explicitly asked for help (which should render connect's help).
	if len(args) >= 1 && args[0] == "connect" && !isHelpRequest(args[1:]) {
		jsonOutput, forwarded := parseConnectArgs(args[1:])
		return runConnect(forwarded, jsonOutput)
	}

	jsonOutput, forwarded := extractRootJSONFlag(args)
	if isUnknownBareCommand(forwarded) {
		// Match Python: surface root help when the environment is missing, then
		// still attempt connect so the missing-env error is reported.
		if !agentcli.HasEnvironment() {
			_ = newRootCommand().Help()
		}
		return runConnect(forwarded, jsonOutput)
	}

	root := newRootCommand()
	root.SetArgs(args)
	return root.Execute()
}

// --- command tree ---

func newRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:           "dify-agent",
		Short:         "Forward shell-visible dify-agent commands to the Dify Agent Stub server.",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.CompletionOptions.DisableDefaultCmd = true
	// The Python CLI exposes no `help` command; hide cobra's auto-added one so
	// the visible command surface stays identical.
	root.SetHelpCommand(&cobra.Command{Hidden: true})
	root.AddCommand(
		newConnectCommand(),
		newFileCommand(),
		newDriveCommand(),
		newConfigCommand(),
	)
	return root
}

func newConnectCommand() *cobra.Command {
	var jsonOutput bool
	// connect is normally intercepted in runCLI; this definition exists so
	// `dify-agent connect --help` renders framework help for the command.
	cmd := &cobra.Command{
		Use:   "connect [ARGV]...",
		Short: "Establish one Agent Stub connection using the current environment.",
		RunE: func(_ *cobra.Command, args []string) error {
			return runConnect(args, jsonOutput)
		},
	}
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Emit the connection response as JSON.")
	return cmd
}

func newFileCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "file",
		Short: "Upload or download workflow files through the Agent Stub.",
	}

	upload := &cobra.Command{
		Use:   "upload PATH",
		Short: "Upload one sandbox-local file as a ToolFile output reference.",
		Args:  cobra.ExactArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunFileUpload(env, args[0])
		}),
	}

	var downloadTo string
	download := &cobra.Command{
		Use:   "download TRANSFER_METHOD REFERENCE_OR_URL",
		Short: "Download one workflow file mapping into the local sandbox directory.",
		Args:  cobra.ExactArgs(2),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunFileDownload(env, args[0], args[1], downloadTo)
		}),
	}
	download.Flags().StringVar(&downloadTo, "to", "", "Local directory for the downloaded file.")

	cmd.AddCommand(upload, download)
	return cmd
}

func newDriveCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "drive",
		Short: "List, pull, or push agent drive files through the Agent Stub.",
	}

	var listJSON bool
	list := &cobra.Command{
		Use:   "list [REMOTE_PREFIX]",
		Short: "List drive files visible to the current sandbox execution.",
		Args:  cobra.MaximumNArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			prefix := ""
			if len(args) > 0 {
				prefix = args[0]
			}
			return agentcli.RunDriveList(env, prefix, listJSON)
		}),
	}
	list.Flags().BoolVar(&listJSON, "json", false, "Emit the drive manifest as JSON.")

	var pullTo string
	var pullJSON bool
	pull := &cobra.Command{
		Use:   "pull [REMOTE]...",
		Short: "Pull one or more drive keys/prefixes into one local directory tree.",
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			localBase := pullTo
			if localBase == "" {
				localBase = agentcli.ReadDriveBase()
			}
			return agentcli.RunDrivePull(env, args, localBase, pullJSON)
		}),
	}
	pull.Flags().StringVar(&pullTo, "to", "", "Local base directory for pulled drive files.")
	pull.Flags().BoolVar(&pullJSON, "json", false, "Emit the pull result as JSON.")

	var pushKind string
	var pushJSON bool
	push := &cobra.Command{
		Use:   "push LOCAL_PATH REMOTE_PATH",
		Short: "Upload one local file or directory into the agent drive.",
		Args:  cobra.ExactArgs(2),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunDrivePush(env, args[0], args[1], pushKind)
		}),
	}
	push.Flags().StringVar(&pushKind, "kind", "", "Directory upload kind: skill or dir.")
	push.Flags().BoolVar(&pushJSON, "json", false, "Accepted for consistency; drive push output is already emitted as JSON.")

	cmd.AddCommand(list, pull, push)
	return cmd
}

func newConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Inspect or update Agent Soul-backed config assets through the Agent Stub.",
	}

	manifest := &cobra.Command{
		Use:   "manifest",
		Short: "Show the current visible Agent config manifest as JSON.",
		Args:  cobra.NoArgs,
		RunE: withEnv(func(env *agentcli.Environment, _ []string, _ *cobra.Command) error {
			return agentcli.RunConfigManifest(env)
		}),
	}

	cmd.AddCommand(
		manifest,
		newConfigSkillsCommand(),
		newConfigSkillPullAliasCommand(),
		newConfigFilesCommand(),
		newConfigFilePullAliasCommand(),
		newConfigEnvCommand(),
		newConfigNoteCommand(),
	)
	return cmd
}

func newConfigSkillsPullCommand() *cobra.Command {
	var to string
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "pull [NAME]...",
		Short: "Pull one or all visible config skills into ./.dify_conf/skills by default.",
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunConfigSkillsPull(env, args, to, jsonOutput)
		}),
	}
	cmd.Flags().StringVar(&to, "to", "", "Local directory for pulled config skills.")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Emit the pull result as JSON.")
	return cmd
}

func newConfigSkillsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "skills",
		Short: "Pull or update config skills through the Agent Stub.",
	}

	push := &cobra.Command{
		Use:   "push PATH...",
		Short: "Upload one or more local skill directories into the current config manifest.",
		Args:  cobra.MinimumNArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunConfigSkillsPush(env, args)
		}),
	}

	del := &cobra.Command{
		Use:   "delete NAME...",
		Short: "Delete one or more config skills by name without touching local directories.",
		Args:  cobra.MinimumNArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunConfigSkillsDelete(env, args)
		}),
	}

	cmd.AddCommand(newConfigSkillsPullCommand(), push, del)
	return cmd
}

// newConfigSkillPullAliasCommand mirrors the hidden singular `config skill pull`
// alias, which is intentionally pull-only.
func newConfigSkillPullAliasCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:    "skill",
		Short:  "Pull config skills through the Agent Stub.",
		Hidden: true,
	}
	cmd.AddCommand(newConfigSkillsPullCommand())
	return cmd
}

func newConfigFilesPullCommand() *cobra.Command {
	var to string
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "pull [NAME]...",
		Short: "Pull one or all visible config files into ./.dify_conf/files by default.",
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunConfigFilesPull(env, args, to, jsonOutput)
		}),
	}
	cmd.Flags().StringVar(&to, "to", "", "Local directory for pulled config files.")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Emit the pull result as JSON.")
	return cmd
}

func newConfigFilesCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "files",
		Short: "Pull or update config files through the Agent Stub.",
	}

	push := &cobra.Command{
		Use:   "push PATH...",
		Short: "Upload one or more local files into the current config manifest.",
		Args:  cobra.MinimumNArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunConfigFilesPush(env, args)
		}),
	}

	del := &cobra.Command{
		Use:   "delete NAME...",
		Short: "Delete one or more config files by name without touching local files.",
		Args:  cobra.MinimumNArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunConfigFilesDelete(env, args)
		}),
	}

	cmd.AddCommand(newConfigFilesPullCommand(), push, del)
	return cmd
}

// newConfigFilePullAliasCommand mirrors the hidden singular `config file pull`
// alias, which is intentionally pull-only.
func newConfigFilePullAliasCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:    "file",
		Short:  "Pull config files through the Agent Stub.",
		Hidden: true,
	}
	cmd.AddCommand(newConfigFilesPullCommand())
	return cmd
}

func newConfigEnvCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "env",
		Short: "Update config env variables visible to the current run.",
	}
	push := &cobra.Command{
		Use:   "push PATH|-",
		Short: "Set or delete config env entries from one local dotenv file or stdin.",
		Args:  cobra.ExactArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			return agentcli.RunConfigEnvPush(env, args[0])
		}),
	}
	cmd.AddCommand(push)
	return cmd
}

func newConfigNoteCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "note",
		Short: "Pull or update the current config note.",
	}

	var pullTo string
	pull := &cobra.Command{
		Use:   "pull",
		Short: "Export the current config note into ./.dify_conf/note.md by default.",
		Args:  cobra.NoArgs,
		RunE: withEnv(func(env *agentcli.Environment, _ []string, _ *cobra.Command) error {
			return agentcli.RunConfigNotePull(env, pullTo)
		}),
	}
	pull.Flags().StringVar(&pullTo, "to", "", "Local markdown file path.")

	push := &cobra.Command{
		Use:   "push [PATH|-]",
		Short: "Replace the current config note from one local text file or stdin.",
		Args:  cobra.MaximumNArgs(1),
		RunE: withEnv(func(env *agentcli.Environment, args []string, _ *cobra.Command) error {
			localPath := ""
			if len(args) > 0 {
				localPath = args[0]
			}
			return agentcli.RunConfigNotePush(env, localPath)
		}),
	}

	cmd.AddCommand(pull, push)
	return cmd
}

// --- connect dispatch helpers (mirror the Python CLI) ---

func runConnect(argv []string, jsonOutput bool) error {
	env, err := agentcli.ReadEnvironment()
	if err != nil {
		return err
	}
	return agentcli.RunConnect(env, argv, jsonOutput)
}

// parseConnectArgs strips a leading `--json` flag and an optional `--`
// separator, matching Python's _parse_connect_args.
func parseConnectArgs(argv []string) (bool, []string) {
	jsonOutput := false
	remaining := append([]string{}, argv...)
	if len(remaining) >= 1 && remaining[0] == "--json" {
		jsonOutput = true
		remaining = remaining[1:]
	}
	if len(remaining) >= 1 && remaining[0] == "--" {
		remaining = remaining[1:]
	}
	return jsonOutput, remaining
}

// extractRootJSONFlag consumes a leading root `--json` flag only when it
// precedes an unknown bare command, matching Python's _extract_root_json_flag.
func extractRootJSONFlag(argv []string) (bool, []string) {
	if len(argv) >= 2 && argv[0] == "--json" && !isKnownRootCommand(argv[1]) {
		return true, argv[1:]
	}
	return false, argv
}

func isUnknownBareCommand(argv []string) bool {
	if len(argv) == 0 {
		return false
	}
	first := argv[0]
	return !isKnownRootCommand(first) && !strings.HasPrefix(first, "-")
}

func isKnownRootCommand(name string) bool {
	_, ok := knownRootCommands[name]
	return ok
}

func isHelpRequest(argv []string) bool {
	for _, v := range argv {
		if v == "--help" || v == "-h" {
			return true
		}
	}
	return false
}

// withEnv adapts a command handler that needs a validated Agent Stub
// environment into a cobra RunE, resolving the environment before dispatch.
func withEnv(fn func(env *agentcli.Environment, args []string, cmd *cobra.Command) error) func(*cobra.Command, []string) error {
	return func(cmd *cobra.Command, args []string) error {
		env, err := agentcli.ReadEnvironment()
		if err != nil {
			return err
		}
		return fn(env, args, cmd)
	}
}
