package main

// dumphelp renders the visible cobra command tree into the JSON snapshot at
// dify-agent/src/dify_agent/layers/_agent_cli_help.json. The Go CLI is the
// single source of truth for both the command surface and its help text; the
// Python server loads this JSON and injects the strings into the agent prompt
// without executing a shell. Emitting JSON keeps the Go side free of any
// Python formatting/encoding concerns.
//
// It is invoked via the hidden `dify-agent __dump-cli-help` intercept (see
// main.go) and driven by `make gen-cli-help` / `go generate`.

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	"github.com/spf13/cobra"
)

// dumpCLIHelp writes the help snapshot as a JSON object mapping each
// space-joined command path (e.g. "config note push") to the verbatim
// `dify-agent <path> --help` output. json.MarshalIndent sorts object keys, so
// the output is deterministic for clean diffs.
func dumpCLIHelp(w io.Writer) error {
	paths := collectHelpPaths(newRootCommand(), nil)
	help := make(map[string]string, len(paths))
	for _, path := range paths {
		help[strings.Join(path, " ")] = captureHelp(path)
	}

	data, err := json.MarshalIndent(help, "", "  ")
	if err != nil {
		return err
	}
	_, err = w.Write(append(data, '\n'))
	return err
}

// collectHelpPaths walks the command tree and returns the path of every visible
// (non-hidden) command, excluding the root itself. Paths are relative to the
// root, e.g. ["config", "note", "push"].
func collectHelpPaths(cmd *cobra.Command, prefix []string) [][]string {
	var paths [][]string
	for _, child := range cmd.Commands() {
		if child.Hidden || child.Name() == "help" {
			continue
		}
		childPath := append(append([]string{}, prefix...), child.Name())
		paths = append(paths, childPath)
		paths = append(paths, collectHelpPaths(child, childPath)...)
	}
	return paths
}

// captureHelp renders one command's `--help` output exactly as the CLI does.
// A fresh root per call avoids leaking parsed flag state between commands,
// mirroring the executeHelp test helper.
func captureHelp(path []string) string {
	root := newRootCommand()
	var buf bytes.Buffer
	root.SetOut(&buf)
	root.SetErr(&buf)
	root.SetArgs(append(append([]string{}, path...), "--help"))
	_ = root.Execute()
	return strings.TrimRight(buf.String(), "\n")
}
