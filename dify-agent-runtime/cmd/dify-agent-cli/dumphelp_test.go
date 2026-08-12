package main

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

// checkedInHelpJSON is the JSON snapshot generated from this command tree,
// relative to the package directory (cmd/dify-agent-cli).
const checkedInHelpJSON = "../../../dify-agent/src/dify_agent/layers/_agent_cli_help.json"

// TestDumpCLIHelpMatchesCheckedIn fails when the committed JSON help snapshot
// drifts from the current Go command tree. Regenerate with:
//
//	make -C dify-agent-runtime gen-cli-help
func TestDumpCLIHelpMatchesCheckedIn(t *testing.T) {
	want, err := os.ReadFile(checkedInHelpJSON)
	if err != nil {
		t.Skipf("checked-in help snapshot not found (%v); run `make gen-cli-help`", err)
	}

	var got bytes.Buffer
	if err := dumpCLIHelp(&got); err != nil {
		t.Fatalf("dumpCLIHelp: %v", err)
	}

	if got.String() != string(want) {
		t.Errorf("%s is stale; regenerate with `make -C dify-agent-runtime gen-cli-help`", checkedInHelpJSON)
	}
}

// TestDumpCLIHelpCoversPromptCommands ensures the generated snapshot includes
// every command path the Python config layer injects into the prompt, and that
// the output is valid JSON keyed by space-joined command paths.
func TestDumpCLIHelpCoversPromptCommands(t *testing.T) {
	var buf bytes.Buffer
	if err := dumpCLIHelp(&buf); err != nil {
		t.Fatalf("dumpCLIHelp: %v", err)
	}

	var table map[string]string
	if err := json.Unmarshal(buf.Bytes(), &table); err != nil {
		t.Fatalf("generated snapshot is not valid JSON: %v", err)
	}

	wantKeys := []string{
		"config",
		"config manifest",
		"config skills pull",
		"config files pull",
		"config note pull",
		"config note push",
		"config env push",
		"config files push",
		"config files delete",
		"config skills push",
		"config skills delete",
		"file upload",
		"file download",
	}
	for _, key := range wantKeys {
		if _, ok := table[key]; !ok {
			t.Errorf("generated snapshot missing prompt command key %q", key)
		}
	}
}
