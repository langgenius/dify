// dify-agent-cli is the Go replacement for the Python dify-agent CLI.
// It communicates with the Agent Stub server via HTTP or gRPC to provide
// connect, file, drive, and config operations inside the sandbox container.
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/langgenius/dify/dify-agent-runtime/internal/agentcli"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "dify-agent: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return printUsage()
	}

	command := args[0]
	rest := args[1:]

	switch command {
	case "connect":
		return handleConnect(rest)
	case "file":
		return handleFile(rest)
	case "drive":
		return handleDrive(rest)
	case "config":
		return handleConfig(rest)
	case "--help", "-h", "help":
		return printUsage()
	default:
		// Unknown commands are treated as argv to connect (like the Python CLI)
		return handleConnectImplicit(args)
	}
}

func printUsage() error {
	fmt.Print(`Usage: dify-agent <command> [options]

Commands:
  connect   Connect to the Agent Stub server
  file      File upload/download operations
  drive     Drive list/pull/push operations
  config    Config manifest/skills/files/env/note operations
  help      Show this help message

Environment Variables:
  DIFY_AGENT_STUB_API_BASE_URL   Agent Stub server URL (http/https/grpc)
  DIFY_AGENT_STUB_AUTH_JWE       Bearer JWE token for authentication
  DIFY_AGENT_STUB_DRIVE_BASE     Local drive base directory (default: /mnt/drive)
`)
	return nil
}

func requireEnv() (*agentcli.Environment, error) {
	return agentcli.ReadEnvironment()
}

// --- connect ---

func handleConnect(args []string) error {
	jsonOutput := removeFlag(&args, "--json")
	env, err := requireEnv()
	if err != nil {
		return err
	}
	return agentcli.RunConnect(env, args, jsonOutput)
}

func handleConnectImplicit(args []string) error {
	jsonOutput := removeFlag(&args, "--json")
	env, err := requireEnv()
	if err != nil {
		return err
	}
	return agentcli.RunConnect(env, args, jsonOutput)
}

// --- file ---

func handleFile(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dify-agent file <upload|download> [options]")
	}

	env, err := requireEnv()
	if err != nil {
		return err
	}

	switch args[0] {
	case "upload":
		if len(args) < 2 {
			return fmt.Errorf("usage: dify-agent file upload <path>")
		}
		return agentcli.RunFileUpload(env, args[1])

	case "download":
		if len(args) < 3 {
			return fmt.Errorf("usage: dify-agent file download <transfer_method> <reference_or_url> [--to <dir>]")
		}
		transferMethod := args[1]
		referenceOrURL := args[2]
		localDir := extractOption(args[3:], "--to")
		return agentcli.RunFileDownload(env, transferMethod, referenceOrURL, localDir)

	default:
		return fmt.Errorf("unknown file subcommand: %s", args[0])
	}
}

// --- drive ---

func handleDrive(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dify-agent drive <list|pull|push> [options]")
	}

	env, err := requireEnv()
	if err != nil {
		return err
	}

	switch args[0] {
	case "list":
		rest := args[1:]
		jsonOutput := removeFlag(&rest, "--json")
		prefix := ""
		if len(rest) > 0 {
			prefix = rest[0]
		}
		return agentcli.RunDriveList(env, prefix, jsonOutput)

	case "pull":
		rest := args[1:]
		jsonOutput := removeFlag(&rest, "--json")
		localBase := extractOption(rest, "--to")
		rest = removeOptionPair(rest, "--to")
		return agentcli.RunDrivePull(env, rest, localBase, jsonOutput)

	case "push":
		rest := args[1:]
		if len(rest) < 2 {
			return fmt.Errorf("usage: dify-agent drive push <local_path> <remote_path> [--kind <file|skill|dir>]")
		}
		localPath := rest[0]
		remotePath := rest[1]
		kind := extractOption(rest[2:], "--kind")
		return agentcli.RunDrivePush(env, localPath, remotePath, kind)

	default:
		return fmt.Errorf("unknown drive subcommand: %s", args[0])
	}
}

// --- config ---

func handleConfig(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dify-agent config <manifest|skills|files|env|note> [options]")
	}

	env, err := requireEnv()
	if err != nil {
		return err
	}

	switch args[0] {
	case "manifest":
		return agentcli.RunConfigManifest(env)

	case "skills":
		return handleConfigSkills(env, args[1:])

	case "files":
		return handleConfigFiles(env, args[1:])

	case "env":
		return handleConfigEnv(env, args[1:])

	case "note":
		return handleConfigNote(env, args[1:])

	default:
		return fmt.Errorf("unknown config subcommand: %s", args[0])
	}
}

func handleConfigSkills(env *agentcli.Environment, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dify-agent config skills <pull|push|delete> [options]")
	}

	switch args[0] {
	case "pull":
		rest := args[1:]
		jsonOutput := removeFlag(&rest, "--json")
		localDir := extractOption(rest, "--to")
		rest = removeOptionPair(rest, "--to")
		return agentcli.RunConfigSkillsPull(env, rest, localDir, jsonOutput)

	case "push":
		return agentcli.RunConfigSkillsPush(env, args[1:])

	case "delete":
		return agentcli.RunConfigSkillsDelete(env, args[1:])

	default:
		return fmt.Errorf("unknown config skills subcommand: %s", args[0])
	}
}

func handleConfigFiles(env *agentcli.Environment, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dify-agent config files <pull|push|delete> [options]")
	}

	switch args[0] {
	case "pull":
		rest := args[1:]
		jsonOutput := removeFlag(&rest, "--json")
		localDir := extractOption(rest, "--to")
		rest = removeOptionPair(rest, "--to")
		return agentcli.RunConfigFilesPull(env, rest, localDir, jsonOutput)

	case "push":
		return agentcli.RunConfigFilesPush(env, args[1:])

	case "delete":
		return agentcli.RunConfigFilesDelete(env, args[1:])

	default:
		return fmt.Errorf("unknown config files subcommand: %s", args[0])
	}
}

func handleConfigEnv(env *agentcli.Environment, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dify-agent config env push <path|->")
	}
	if args[0] != "push" {
		return fmt.Errorf("unknown config env subcommand: %s", args[0])
	}
	if len(args) < 2 {
		return fmt.Errorf("usage: dify-agent config env push <path|->")
	}
	return agentcli.RunConfigEnvPush(env, args[1])
}

func handleConfigNote(env *agentcli.Environment, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dify-agent config note <pull|push> [options]")
	}

	switch args[0] {
	case "pull":
		localPath := ""
		if len(args) > 1 {
			localPath = extractOption(args[1:], "--to")
			if localPath == "" && len(args) > 1 {
				localPath = args[1]
			}
		}
		return agentcli.RunConfigNotePull(env, localPath)

	case "push":
		localPath := ""
		if len(args) > 1 {
			localPath = args[1]
		}
		return agentcli.RunConfigNotePush(env, localPath)

	default:
		return fmt.Errorf("unknown config note subcommand: %s", args[0])
	}
}

// --- helpers ---

// removeFlag removes a boolean flag from args and returns whether it was present.
func removeFlag(args *[]string, flag string) bool {
	for i, a := range *args {
		if a == flag {
			*args = append((*args)[:i], (*args)[i+1:]...)
			return true
		}
	}
	return false
}

// extractOption extracts the value for a key-value flag like --to <value>.
func extractOption(args []string, key string) string {
	for i, a := range args {
		if a == key && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(a, key+"=") {
			return strings.TrimPrefix(a, key+"=")
		}
	}
	return ""
}

// removeOptionPair removes a key-value flag pair from args.
func removeOptionPair(args []string, key string) []string {
	var result []string
	skip := false
	for i, a := range args {
		if skip {
			skip = false
			continue
		}
		if a == key && i+1 < len(args) {
			skip = true
			continue
		}
		if strings.HasPrefix(a, key+"=") {
			continue
		}
		result = append(result, a)
	}
	return result
}
