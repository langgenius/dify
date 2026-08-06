// Tests that `--help` renders correctly for every command and subcommand in
// the cobra tree, including the hidden singular `config skill|file` aliases.
// These lock the command surface so it stays identical to the original Python
// (Typer) CLI: each help output must show the command's usage path, its
// Short description, and its expected flags/subcommands.
package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// executeHelp builds a fresh root command, runs it with the given args, and
// returns the captured stdout/stderr. A fresh tree per call avoids leaking
// parsed flag state between cases.
func executeHelp(t *testing.T, args ...string) string {
	t.Helper()
	root := newRootCommand()
	var buf bytes.Buffer
	root.SetOut(&buf)
	root.SetErr(&buf)
	root.SetArgs(args)
	if err := root.Execute(); err != nil {
		t.Fatalf("execute %v: %v", args, err)
	}
	return buf.String()
}

func TestCommandHelp(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want []string
	}{
		{
			name: "root",
			args: []string{"--help"},
			want: []string{"Usage:", "dify-agent", "config", "connect", "drive", "file"},
		},
		{
			name: "connect",
			args: []string{"connect", "--help"},
			want: []string{"dify-agent connect", "Establish one Agent Stub connection", "--json"},
		},
		{
			name: "file",
			args: []string{"file", "--help"},
			want: []string{"dify-agent file", "upload", "download"},
		},
		{
			name: "file upload",
			args: []string{"file", "upload", "--help"},
			want: []string{"dify-agent file upload", "Upload one sandbox-local file"},
		},
		{
			name: "file download",
			args: []string{"file", "download", "--help"},
			want: []string{"dify-agent file download", "Download one workflow file", "--to"},
		},
		{
			name: "drive",
			args: []string{"drive", "--help"},
			want: []string{"dify-agent drive", "list", "pull", "push"},
		},
		{
			name: "drive list",
			args: []string{"drive", "list", "--help"},
			want: []string{"dify-agent drive list", "List drive files", "--json"},
		},
		{
			name: "drive pull",
			args: []string{"drive", "pull", "--help"},
			want: []string{"dify-agent drive pull", "Pull one or more drive", "--to", "--json"},
		},
		{
			name: "drive push",
			args: []string{"drive", "push", "--help"},
			want: []string{"dify-agent drive push", "Upload one local file or directory", "--kind", "--json"},
		},
		{
			name: "config",
			args: []string{"config", "--help"},
			want: []string{"dify-agent config", "manifest", "skills", "files", "env", "note"},
		},
		{
			name: "config manifest",
			args: []string{"config", "manifest", "--help"},
			want: []string{"dify-agent config manifest", "Show the current visible Agent config manifest"},
		},
		{
			name: "config skills",
			args: []string{"config", "skills", "--help"},
			want: []string{"dify-agent config skills", "pull", "push", "delete"},
		},
		{
			name: "config skills pull",
			args: []string{"config", "skills", "pull", "--help"},
			want: []string{"dify-agent config skills pull", "Pull one or all visible config skills", "--to", "--json"},
		},
		{
			name: "config skills push",
			args: []string{"config", "skills", "push", "--help"},
			want: []string{"dify-agent config skills push", "Upload one or more local skill directories"},
		},
		{
			name: "config skills delete",
			args: []string{"config", "skills", "delete", "--help"},
			want: []string{"dify-agent config skills delete", "Delete one or more config skills"},
		},
		{
			name: "config files",
			args: []string{"config", "files", "--help"},
			want: []string{"dify-agent config files", "pull", "push", "delete"},
		},
		{
			name: "config files pull",
			args: []string{"config", "files", "pull", "--help"},
			want: []string{"dify-agent config files pull", "Pull one or all visible config files", "--to", "--json"},
		},
		{
			name: "config files push",
			args: []string{"config", "files", "push", "--help"},
			want: []string{"dify-agent config files push", "Upload one or more local files"},
		},
		{
			name: "config files delete",
			args: []string{"config", "files", "delete", "--help"},
			want: []string{"dify-agent config files delete", "Delete one or more config files"},
		},
		{
			name: "config env",
			args: []string{"config", "env", "--help"},
			want: []string{"dify-agent config env", "push"},
		},
		{
			name: "config env push",
			args: []string{"config", "env", "push", "--help"},
			want: []string{"dify-agent config env push", "Set or delete config env entries"},
		},
		{
			name: "config note",
			args: []string{"config", "note", "--help"},
			want: []string{"dify-agent config note", "pull", "push"},
		},
		{
			name: "config note pull",
			args: []string{"config", "note", "pull", "--help"},
			want: []string{"dify-agent config note pull", "Export the current config note", "--to"},
		},
		{
			name: "config note push",
			args: []string{"config", "note", "push", "--help"},
			want: []string{"dify-agent config note push", "Replace the current config note"},
		},
		{
			name: "config skill pull (hidden alias)",
			args: []string{"config", "skill", "pull", "--help"},
			want: []string{"dify-agent config skill pull", "Pull one or all visible config skills", "--to", "--json"},
		},
		{
			name: "config file pull (hidden alias)",
			args: []string{"config", "file", "pull", "--help"},
			want: []string{"dify-agent config file pull", "Pull one or all visible config files", "--to", "--json"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := executeHelp(t, tc.args...)
			for _, want := range tc.want {
				if !strings.Contains(out, want) {
					t.Errorf("help for %v missing %q\n--- help output ---\n%s", tc.args, want, out)
				}
			}
		})
	}
}

// findCommand walks the cobra tree by command name (the first word of Use),
// returning nil when any path segment is missing.
func findCommand(root *cobra.Command, path ...string) *cobra.Command {
	current := root
	for _, name := range path {
		var next *cobra.Command
		for _, child := range current.Commands() {
			if child.Name() == name {
				next = child
				break
			}
		}
		if next == nil {
			return nil
		}
		current = next
	}
	return current
}

// TestHiddenAliasesRemainHidden verifies the singular `config skill|file`
// aliases exist (so their pull help still renders) but stay hidden from the
// parent's command listing, matching the Python CLI's hidden aliases.
func TestHiddenAliasesRemainHidden(t *testing.T) {
	root := newRootCommand()
	for _, alias := range [][]string{{"config", "skill"}, {"config", "file"}} {
		cmd := findCommand(root, alias...)
		if cmd == nil {
			t.Errorf("hidden alias %v not registered", alias)
			continue
		}
		if !cmd.Hidden {
			t.Errorf("alias %v must be hidden", alias)
		}
		if findCommand(cmd, "pull") == nil {
			t.Errorf("alias %v must expose a pull subcommand", alias)
		}
	}

	// The hidden singular aliases must not appear in `config --help`.
	configHelp := executeHelp(t, "config", "--help")
	for _, unwanted := range []string{"  skill ", "  file "} {
		if strings.Contains(configHelp, unwanted) {
			t.Errorf("config help unexpectedly lists hidden alias %q\n--- help output ---\n%s", unwanted, configHelp)
		}
	}
}
