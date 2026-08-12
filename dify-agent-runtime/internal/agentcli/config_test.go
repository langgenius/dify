package agentcli

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigPullRequestsURLThenDownloadsFromDataPlane(t *testing.T) {
	skillArchive := zipFixture(t, map[string]string{"SKILL.md": "# Alpha\n", "reference.md": "guide"})
	tests := []struct {
		name        string
		kind        string
		assetName   string
		payload     []byte
		run         func(*Environment, string) error
		assertFiles func(*testing.T, string)
	}{
		{
			name:      "file",
			kind:      "file",
			assetName: "guide.txt",
			payload:   []byte("guide"),
			run: func(env *Environment, targetDir string) error {
				return RunConfigFilesPull(env, []string{"guide.txt"}, targetDir, true)
			},
			assertFiles: func(t *testing.T, targetDir string) {
				data, err := os.ReadFile(filepath.Join(targetDir, "guide.txt"))
				if err != nil {
					t.Fatalf("read pulled config file: %v", err)
				}
				if string(data) != "guide" {
					t.Fatalf("pulled config file = %q", data)
				}
			},
		},
		{
			name:      "skill",
			kind:      "skill",
			assetName: "alpha",
			payload:   skillArchive,
			run: func(env *Environment, targetDir string) error {
				return RunConfigSkillsPull(env, []string{"alpha"}, targetDir, true)
			},
			assertFiles: func(t *testing.T, targetDir string) {
				data, err := os.ReadFile(filepath.Join(targetDir, "alpha", "SKILL.md"))
				if err != nil {
					t.Fatalf("read pulled skill: %v", err)
				}
				if string(data) != "# Alpha\n" {
					t.Fatalf("pulled SKILL.md = %q", data)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var controlPayload map[string]any
			dataPlaneCalls := 0
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/agent-stub/files/download-request":
					if err := json.NewDecoder(r.Body).Decode(&controlPayload); err != nil {
						http.Error(w, "bad request", http.StatusBadRequest)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"filename":     test.assetName,
						"mime_type":    "application/octet-stream",
						"size":         len(test.payload),
						"download_url": server.URL + "/files/config-asset",
					})
				case "/files/config-asset":
					dataPlaneCalls++
					_, _ = w.Write(test.payload)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			targetDir := t.TempDir()
			err := test.run(&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"}, targetDir)
			if err != nil {
				t.Fatalf("pull config %s: %v", test.kind, err)
			}

			config, ok := controlPayload["config"].(map[string]any)
			if !ok {
				t.Fatalf("control payload config = %#v", controlPayload["config"])
			}
			if config["kind"] != test.kind || config["name"] != test.assetName {
				t.Fatalf("control payload config = %#v", config)
			}
			if controlPayload["for_frontend"] != false {
				t.Fatalf("for_frontend = %#v", controlPayload["for_frontend"])
			}
			if dataPlaneCalls != 1 {
				t.Fatalf("data-plane calls = %d, want 1", dataPlaneCalls)
			}
			test.assertFiles(t, targetDir)
		})
	}
}

func TestConfigPullReportsControlAndDataPlaneFailures(t *testing.T) {
	tests := []struct {
		name          string
		controlStatus int
		dataStatus    int
		want          string
	}{
		{name: "control", controlStatus: http.StatusNotFound, dataStatus: http.StatusOK, want: "config download request failed"},
		{name: "data plane", controlStatus: http.StatusOK, dataStatus: http.StatusBadGateway, want: "download config file"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/agent-stub/files/download-request":
					if test.controlStatus != http.StatusOK {
						w.WriteHeader(test.controlStatus)
						_, _ = w.Write([]byte(`{"detail":"missing"}`))
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"filename": "guide.txt", "size": 5, "download_url": server.URL + "/files/config-asset",
					})
				case "/files/config-asset":
					w.WriteHeader(test.dataStatus)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			err := RunConfigFilesPull(
				&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
				[]string{"guide.txt"},
				t.TempDir(),
				true,
			)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func zipFixture(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for name, content := range files {
		writer, err := archive.Create(name)
		if err != nil {
			t.Fatalf("create zip member: %v", err)
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			t.Fatalf("write zip member: %v", err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close zip fixture: %v", err)
	}
	return buffer.Bytes()
}
