package main

import (
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/envvar"
)

func TestRemoveIsolationOverridesPreservesApplicationEnvironment(t *testing.T) {
	environment := map[string]string{
		envvar.EnvEnablePathIsolation: "false",
		envvar.EnvRWPaths:             "/tmp",
		envvar.EnvROPaths:             "",
		envvar.EnvRWDevPaths:          "/dev",
		"APPLICATION_VALUE":           "kept",
	}

	removeIsolationOverrides(environment)

	if got := environment["APPLICATION_VALUE"]; got != "kept" {
		t.Fatalf("application environment = %q, want kept", got)
	}
	for _, key := range []string{
		envvar.EnvEnablePathIsolation,
		envvar.EnvRWPaths,
		envvar.EnvROPaths,
		envvar.EnvRWDevPaths,
	} {
		if _, exists := environment[key]; exists {
			t.Fatalf("runner-controlled environment %q was not removed", key)
		}
	}
}
