package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeAuthTokenValidationBeforeInitialization(test *testing.T) {
	for _, testCase := range []struct {
		name        string
		envToken    *string
		flags       []string
		wantAuthErr bool
	}{
		{name: "unset", flags: []string{"--require-auth-token"}, wantAuthErr: true},
		{name: "empty", envToken: new(""), flags: []string{"--require-auth-token"}, wantAuthErr: true},
		{name: "whitespace", envToken: new(" \t\n"), flags: []string{"--require-auth-token"}, wantAuthErr: true},
		{name: "environment", envToken: new(" env-secret "), flags: []string{"--require-auth-token"}},
		{name: "cli override", envToken: new(""), flags: []string{"--require-auth-token", "--token", " cli-secret "}},
		{name: "blank cli override", envToken: new("env-secret"), flags: []string{"--require-auth-token", "--token", " \t"}, wantAuthErr: true},
		{name: "empty cli preserves environment", envToken: new("env-secret"), flags: []string{"--require-auth-token", "--token", ""}},
		{name: "default permits unset"},
	} {
		test.Run(testCase.name, func(test *testing.T) {
			if testCase.envToken == nil {
				test.Setenv("SHELLCTL_AUTH_TOKEN", "")
				if err := os.Unsetenv("SHELLCTL_AUTH_TOKEN"); err != nil {
					test.Fatal(err)
				}
			} else {
				test.Setenv("SHELLCTL_AUTH_TOKEN", *testCase.envToken)
			}
			test.Setenv("SHELLCTL_SNAPSHOT_TIMEOUT", "")
			stateDir := filepath.Join(test.TempDir(), "state")
			if !testCase.wantAuthErr {
				if err := os.WriteFile(stateDir, nil, 0600); err != nil {
					test.Fatal(err)
				}
			}
			originalArgs := os.Args
			test.Cleanup(func() { os.Args = originalArgs })
			os.Args = append([]string{"shellctl", "serve", "--state-dir", stateDir}, testCase.flags...)
			err := run()
			if err == nil {
				test.Fatal("expected startup error")
			}
			if testCase.wantAuthErr {
				if err.Error() != "auth token is required: set SHELLCTL_AUTH_TOKEN or --token" {
					test.Fatalf("expected token error before initialization, got %v", err)
				}
				if _, statErr := os.Stat(stateDir); !os.IsNotExist(statErr) {
					test.Fatalf("state directory created before token validation: %v", statErr)
				}
			} else if !strings.HasPrefix(err.Error(), "initialize:") {
				test.Fatalf("expected initialization after accepted token, got %v", err)
			}
		})
	}
}
