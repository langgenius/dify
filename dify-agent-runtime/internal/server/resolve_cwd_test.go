package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveCwd(t *testing.T) {
	tmpDir := t.TempDir()

	workspaceSub := filepath.Join(tmpDir, "workspace")
	if err := os.MkdirAll(workspaceSub, 0755); err != nil {
		t.Fatal(err)
	}
	outsideDir := filepath.Join(tmpDir, "outside")
	if err := os.MkdirAll(outsideDir, 0755); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name       string
		cwd        *string
		defaultCwd string
		wantErr    bool
		errCode    string
	}{
		{name: "nil cwd uses DefaultCwd", cwd: nil, defaultCwd: workspaceSub, wantErr: false},
		{name: "empty cwd uses DefaultCwd", cwd: strptr(""), defaultCwd: workspaceSub, wantErr: false},
		{name: "cwd inside workspace root", cwd: strptr(workspaceSub), defaultCwd: workspaceSub, wantErr: false},
		{name: "cwd outside workspace root", cwd: strptr(outsideDir), defaultCwd: workspaceSub, wantErr: true, errCode: "cwd_not_allowed"},
		{name: "cwd equals workspace root", cwd: strptr(workspaceSub), defaultCwd: workspaceSub, wantErr: false},
		{name: "non-existent cwd", cwd: strptr("/nonexistent/path/xyz"), defaultCwd: workspaceSub, wantErr: true, errCode: "invalid_cwd"},
		{name: "mismatched default rejects", cwd: strptr(workspaceSub), defaultCwd: "/some/other/path", wantErr: true, errCode: "cwd_not_allowed"},
		{name: "cwd in root subdirectory", cwd: strptr(workspaceSub), defaultCwd: tmpDir, wantErr: false},
		{name: "cwd outside when root is tmpDir", cwd: strptr("/etc"), defaultCwd: tmpDir, wantErr: true, errCode: "cwd_not_allowed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &Service{config: &Config{DefaultCwd: tt.defaultCwd}}
			abs, err := s.resolveCwd(tt.cwd)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got abs=%q", abs)
				}
				if tt.errCode != "" {
					se, ok := err.(*ServerError)
					if !ok {
						t.Fatalf("expected *ServerError, got %T: %v", err, err)
					}
					if se.Code != tt.errCode {
						t.Fatalf("expected code=%q, got %q", tt.errCode, se.Code)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !strings.HasPrefix(abs, tt.defaultCwd) {
				t.Fatalf("resolved cwd %q not under root %q", abs, tt.defaultCwd)
			}
		})
	}
}

func TestResolveCwd_ExplicitTrustedRoot(t *testing.T) {
	tmpDir := t.TempDir()
	workspace := filepath.Join(tmpDir, "ws")
	outside := filepath.Join(tmpDir, "ws2")
	for _, d := range []string{workspace, outside} {
		os.MkdirAll(d, 0755)
	}

	s := &Service{
		config: &Config{
			DefaultCwd:          workspace,
			TrustedWorkspaceRoot: workspace,
		},
	}

	_, err := s.resolveCwd(strptr(workspace))
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}

	_, err = s.resolveCwd(strptr(outside))
	if err == nil {
		t.Fatal("expected rejection for cwd outside explicit TrustedWorkspaceRoot")
	}
}

func strptr(s string) *string { return &s }
