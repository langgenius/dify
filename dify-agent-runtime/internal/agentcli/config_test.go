package agentcli

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type configPushCapture struct {
	payload map[string]any
	upload  []byte
}

func newConfigPushServer(t *testing.T) (*httptest.Server, *configPushCapture) {
	t.Helper()
	capture := &configPushCapture{}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/agent-stub/files/upload-request":
			_ = json.NewEncoder(w).Encode(map[string]string{"upload_url": server.URL + "/uploads/config-asset"})
		case "/uploads/config-asset":
			file, _, err := r.FormFile("file")
			if err != nil {
				http.Error(w, "missing upload", http.StatusBadRequest)
				return
			}
			defer func() { _ = file.Close() }()
			capture.upload, err = io.ReadAll(file)
			if err != nil {
				http.Error(w, "bad upload", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "tool-file-1"})
		case "/agent-stub/config/push":
			if err := json.NewDecoder(r.Body).Decode(&capture.payload); err != nil {
				http.Error(w, "bad config", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"result": "success"})
		default:
			http.NotFound(w, r)
		}
	}))
	return server, capture
}

func assertConfigPushItem(t *testing.T, payload map[string]any, key string, name string) {
	t.Helper()
	items, ok := payload[key].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("%s = %#v, want one item", key, payload[key])
	}
	item, ok := items[0].(map[string]any)
	if !ok || item["name"] != name {
		t.Fatalf("%s item = %#v", key, items[0])
	}
	fileRef, ok := item["file_ref"].(map[string]any)
	if !ok || fileRef["kind"] != "tool_file" || fileRef["id"] != "tool-file-1" {
		t.Fatalf("file_ref = %#v", item["file_ref"])
	}
}

func TestConfigFilesPushUploadsFileAndPushesToolFileRef(t *testing.T) {
	server, capture := newConfigPushServer(t)
	defer server.Close()

	filePath := filepath.Join(t.TempDir(), "guide.txt")
	if err := os.WriteFile(filePath, []byte("guide"), 0o644); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	if err := RunConfigFilesPush(
		&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
		[]string{filePath},
	); err != nil {
		t.Fatalf("push config file: %v", err)
	}

	if string(capture.upload) != "guide" {
		t.Fatalf("uploaded file = %q", capture.upload)
	}
	assertConfigPushItem(t, capture.payload, "files", "guide.txt")
}

func TestConfigSkillsPushUploadsArchiveAndPushesToolFileRef(t *testing.T) {
	server, capture := newConfigPushServer(t)
	defer server.Close()

	skillDir := filepath.Join(t.TempDir(), "alpha")
	if err := os.Mkdir(skillDir, 0o755); err != nil {
		t.Fatalf("create skill directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("# Alpha\n"), 0o644); err != nil {
		t.Fatalf("write SKILL.md: %v", err)
	}
	if err := RunConfigSkillsPush(
		&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
		[]string{skillDir},
	); err != nil {
		t.Fatalf("push config skill: %v", err)
	}

	archive, err := zip.NewReader(bytes.NewReader(capture.upload), int64(len(capture.upload)))
	if err != nil {
		t.Fatalf("open uploaded skill archive: %v", err)
	}
	foundSkillMD := false
	for _, file := range archive.File {
		if file.Name == "SKILL.md" {
			foundSkillMD = true
			break
		}
	}
	if !foundSkillMD {
		t.Fatalf("uploaded skill archive does not contain SKILL.md")
	}
	assertConfigPushItem(t, capture.payload, "skills", "alpha")
}

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

func TestConfigPullsDownloadConcurrentlyAndPreserveOutputOrder(t *testing.T) {
	tests := []struct {
		name         string
		kind         string
		names        []string
		payloads     map[string][]byte
		run          func(*Environment, []string, string) error
		assertOutput func(*testing.T, string, string)
	}{
		{
			name:  "files JSON output",
			kind:  "file",
			names: []string{"first.txt", "second.txt"},
			payloads: map[string][]byte{
				"first.txt":  []byte("first file"),
				"second.txt": []byte("second file"),
			},
			run: func(env *Environment, names []string, targetDir string) error {
				return RunConfigFilesPull(env, names, targetDir, true)
			},
			assertOutput: func(t *testing.T, targetDir string, output string) {
				t.Helper()
				var result struct {
					Items []struct {
						Name string `json:"name"`
						Path string `json:"path"`
					} `json:"items"`
				}
				if err := json.Unmarshal([]byte(output), &result); err != nil {
					t.Fatalf("parse JSON output %q: %v", output, err)
				}
				if len(result.Items) != 2 {
					t.Fatalf("output items = %#v, want two items", result.Items)
				}
				for index, name := range []string{"first.txt", "second.txt"} {
					if result.Items[index].Name != name {
						t.Errorf("item %d name = %q, want %q", index, result.Items[index].Name, name)
					}
					wantPath := filepath.Join(targetDir, name)
					if result.Items[index].Path != wantPath {
						t.Errorf("item %d path = %q, want %q", index, result.Items[index].Path, wantPath)
					}
				}
			},
		},
		{
			name:  "skills text output",
			kind:  "skill",
			names: []string{"alpha", "beta"},
			payloads: map[string][]byte{
				"alpha": zipFixture(t, map[string]string{"SKILL.md": "# Alpha\n"}),
				"beta":  zipFixture(t, map[string]string{"SKILL.md": "# Beta\n"}),
			},
			run: func(env *Environment, names []string, targetDir string) error {
				return RunConfigSkillsPull(env, names, targetDir, false)
			},
			assertOutput: func(t *testing.T, targetDir string, output string) {
				t.Helper()
				want := filepath.Join(targetDir, "alpha") + "\n# Alpha\n\n" +
					filepath.Join(targetDir, "beta") + "\n# Beta\n"
				if output != want {
					t.Errorf("text output = %q, want %q", output, want)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var server *httptest.Server
			bothDownloadsStarted := make(chan struct{})
			secondResponseWritten := make(chan struct{})
			var startMu sync.Mutex
			started := 0

			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/agent-stub/files/download-request":
					var request struct {
						Config struct {
							Kind string `json:"kind"`
							Name string `json:"name"`
						} `json:"config"`
					}
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						http.Error(w, "bad request", http.StatusBadRequest)
						return
					}
					if request.Config.Kind != test.kind {
						t.Errorf("config kind = %q, want %q", request.Config.Kind, test.kind)
					}
					if _, ok := test.payloads[request.Config.Name]; !ok {
						http.Error(w, "unknown target", http.StatusBadRequest)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"filename":     request.Config.Name,
						"size":         len(test.payloads[request.Config.Name]),
						"download_url": server.URL + "/files/config-asset?name=" + url.QueryEscape(request.Config.Name),
					})
				case "/files/config-asset":
					name := r.URL.Query().Get("name")
					payload, ok := test.payloads[name]
					if !ok {
						http.Error(w, "unknown target", http.StatusNotFound)
						return
					}

					startMu.Lock()
					started++
					if started == len(test.names) {
						close(bothDownloadsStarted)
					}
					startMu.Unlock()

					select {
					case <-bothDownloadsStarted:
					case <-time.After(2 * time.Second):
						http.Error(w, "downloads did not overlap", http.StatusGatewayTimeout)
						return
					}
					if name == test.names[0] {
						select {
						case <-secondResponseWritten:
						case <-time.After(2 * time.Second):
							http.Error(w, "second response did not finish first", http.StatusGatewayTimeout)
							return
						}
					}

					_, _ = w.Write(payload)
					if name == test.names[1] {
						close(secondResponseWritten)
					}
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			targetDir := t.TempDir()
			output, err := captureConfigStdout(t, func() error {
				return test.run(
					&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
					test.names,
					targetDir,
				)
			})
			if err != nil {
				t.Fatalf("pull config %s: %v", test.kind, err)
			}
			test.assertOutput(t, targetDir, output)
		})
	}
}

func TestConfigFilesPullLimitsActiveRequestsAndRunsQueuedTarget(t *testing.T) {
	names := []string{"one.txt", "two.txt", "three.txt", "four.txt", "five.txt"}
	entered := make(chan string, len(names))
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/agent-stub/files/download-request":
			var request struct {
				Config struct {
					Name string `json:"name"`
				} `json:"config"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			entered <- request.Config.Name
			select {
			case <-release:
			case <-time.After(2 * time.Second):
				http.Error(w, "request was not released", http.StatusGatewayTimeout)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"filename":     request.Config.Name,
				"download_url": server.URL + "/files/config-asset?name=" + url.QueryEscape(request.Config.Name),
			})
		case "/files/config-asset":
			_, _ = w.Write([]byte(r.URL.Query().Get("name")))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() {
		unblock()
		server.Close()
	}()

	done := make(chan error, 1)
	targetDir := t.TempDir()
	go func() {
		done <- RunConfigFilesPull(
			&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
			names,
			targetDir,
			true,
		)
	}()

	for range 4 {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatal("four config pull requests did not enter concurrently")
		}
	}
	select {
	case <-entered:
		t.Fatal("a fifth request entered above the four-request limit")
	case <-time.After(100 * time.Millisecond):
	}

	unblock()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("queued config pull request did not proceed after release")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("pull config files: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("config files pull did not finish")
	}
}

func TestConfigFilesPullReturnsAllFailuresInInputOrderAfterLaterFailureCompletesFirst(t *testing.T) {
	names := []string{"earlier-failure.txt", "later-failure.txt"}
	laterFailureEmitted := make(chan struct{})

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/agent-stub/files/download-request":
			var request struct {
				Config struct {
					Name string `json:"name"`
				} `json:"config"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}

			switch request.Config.Name {
			case names[0]:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"filename":     request.Config.Name,
					"download_url": server.URL + "/files/config-asset",
				})
			case names[1]:
				http.Error(w, "later input failed first", http.StatusServiceUnavailable)
				close(laterFailureEmitted)
				return
			default:
				http.Error(w, "unknown target", http.StatusBadRequest)
			}
		case "/files/config-asset":
			select {
			case <-laterFailureEmitted:
			case <-time.After(2 * time.Second):
				http.Error(w, "later failure was not emitted", http.StatusGatewayTimeout)
				return
			}
			http.Error(w, "earlier input failed later", http.StatusBadGateway)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	done := make(chan error, 1)
	targetDir := t.TempDir()
	go func() {
		done <- RunConfigFilesPull(
			&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
			names,
			targetDir,
			true,
		)
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("error = nil, want both config pull failures")
		}
		errorText := err.Error()
		earlierWrapper := `download config file "earlier-failure.txt"`
		earlierMessage := "earlier input failed later"
		laterWrapper := `request config file "later-failure.txt" download URL`
		laterMessage := "later input failed first"
		earlierWrapperIndex := strings.Index(errorText, earlierWrapper)
		earlierMessageIndex := strings.Index(errorText, earlierMessage)
		laterWrapperIndex := strings.Index(errorText, laterWrapper)
		laterMessageIndex := strings.Index(errorText, laterMessage)
		if earlierWrapperIndex == -1 || earlierMessageIndex == -1 || laterWrapperIndex == -1 || laterMessageIndex == -1 {
			t.Fatalf(
				"error = %q, want both wrapped failures with messages %q and %q",
				errorText,
				earlierMessage,
				laterMessage,
			)
		}
		if earlierWrapperIndex >= earlierMessageIndex || earlierMessageIndex >= laterWrapperIndex || laterWrapperIndex >= laterMessageIndex {
			t.Fatalf("error = %q, want failures in input order", errorText)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("config files pull did not finish")
	}
}

func TestConfigPullMultiItemFailuresIdentifyItemAndStage(t *testing.T) {
	skillArchive := zipFixture(t, map[string]string{"SKILL.md": "# Alpha\n"})
	tests := []struct {
		name         string
		kind         string
		names        []string
		payload      []byte
		failureStage string
		wantStage    string
	}{
		{
			name:         "file control-plane URL acquisition",
			kind:         "file",
			names:        []string{"first.txt", "second.txt"},
			payload:      []byte("first file"),
			failureStage: "control",
			wantStage:    `request config file "second.txt" download URL`,
		},
		{
			name:         "file signed-URL download",
			kind:         "file",
			names:        []string{"first.txt", "second.txt"},
			payload:      []byte("first file"),
			failureStage: "data",
			wantStage:    `download config file "second.txt"`,
		},
		{
			name:         "skill control-plane URL acquisition",
			kind:         "skill",
			names:        []string{"alpha", "beta"},
			payload:      skillArchive,
			failureStage: "control",
			wantStage:    `request config skill "beta" download URL`,
		},
		{
			name:         "skill signed-URL download",
			kind:         "skill",
			names:        []string{"alpha", "beta"},
			payload:      skillArchive,
			failureStage: "data",
			wantStage:    `download config skill "beta"`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var controlCalls atomic.Int32
			var dataPlaneCalls atomic.Int32
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/agent-stub/files/download-request":
					controlCalls.Add(1)
					var request struct {
						Config struct {
							Kind string `json:"kind"`
							Name string `json:"name"`
						} `json:"config"`
					}
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Errorf("decode download request: %v", err)
						http.Error(w, "bad request", http.StatusBadRequest)
						return
					}
					if request.Config.Kind != test.kind {
						t.Errorf("config kind = %q, want %q", request.Config.Kind, test.kind)
					}
					if test.failureStage == "control" && request.Config.Name == test.names[1] {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusUnauthorized)
						_, _ = w.Write([]byte(`{"detail":{"code":"agent_stub_authorization_expired","message":"expired"}}`))
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"filename":     request.Config.Name,
						"size":         len(test.payload),
						"download_url": server.URL + "/files/config-asset?name=" + url.QueryEscape(request.Config.Name),
					})
				case "/files/config-asset":
					dataPlaneCalls.Add(1)
					if test.failureStage == "data" && r.URL.Query().Get("name") == test.names[1] {
						http.Error(w, "data plane unavailable", http.StatusBadGateway)
						return
					}
					_, _ = w.Write(test.payload)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			targetDir := t.TempDir()
			env := &Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"}
			var err error
			if test.kind == "file" {
				err = RunConfigFilesPull(env, test.names, targetDir, true)
			} else {
				err = RunConfigSkillsPull(env, test.names, targetDir, true)
			}
			if err == nil {
				t.Fatal("config pull succeeded, want second-item failure")
			}
			if !strings.Contains(err.Error(), test.wantStage) {
				t.Errorf("error = %q, want stage %q", err, test.wantStage)
			}
			if controlCalls.Load() != 2 {
				t.Errorf("control-plane calls = %d, want 2", controlCalls.Load())
			}
			wantDataPlaneCalls := 2
			if test.failureStage == "control" {
				wantDataPlaneCalls = 1
				for _, want := range []string{
					"expired after 5 minutes",
					"will not refresh automatically",
					"start a new shell tool call",
					"retry the command",
				} {
					if !strings.Contains(err.Error(), want) {
						t.Errorf("error = %q, want expiration guidance %q", err, want)
					}
				}
			}
			if int(dataPlaneCalls.Load()) != wantDataPlaneCalls {
				t.Errorf("data-plane calls = %d, want %d", dataPlaneCalls.Load(), wantDataPlaneCalls)
			}

			if test.kind == "file" {
				data, readErr := os.ReadFile(filepath.Join(targetDir, test.names[0]))
				if readErr != nil || !bytes.Equal(data, test.payload) {
					t.Errorf("first file was not completed: data=%q err=%v", data, readErr)
				}
			} else {
				data, readErr := os.ReadFile(filepath.Join(targetDir, test.names[0], "SKILL.md"))
				if readErr != nil || string(data) != "# Alpha\n" {
					t.Errorf("first skill was not completed: data=%q err=%v", data, readErr)
				}
			}
		})
	}
}

func TestConfigPushMultiItemUploadFailuresIdentifyItemAndStage(t *testing.T) {
	tests := []struct {
		name         string
		failureStage string
		makeSources  func(*testing.T) []string
		run          func(*Environment, []string) error
		wantItem     string
	}{
		{
			name:         "file control-plane URL acquisition",
			failureStage: "request upload URL",
			makeSources:  makeConfigFileSources,
			run:          RunConfigFilesPush,
			wantItem:     `config file "second.txt"`,
		},
		{
			name:         "file signed URL data transfer",
			failureStage: "upload data",
			makeSources:  makeConfigFileSources,
			run:          RunConfigFilesPush,
			wantItem:     `config file "second.txt"`,
		},
		{
			name:         "skill control-plane URL acquisition",
			failureStage: "request upload URL",
			makeSources:  makeConfigSkillSources,
			run:          RunConfigSkillsPush,
			wantItem:     `config skill "beta"`,
		},
		{
			name:         "skill signed URL data transfer",
			failureStage: "upload data",
			makeSources:  makeConfigSkillSources,
			run:          RunConfigSkillsPush,
			wantItem:     `config skill "beta"`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			uploadRequestCalls := 0
			dataPlaneCalls := 0
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/agent-stub/files/upload-request":
					uploadRequestCalls++
					if test.failureStage == "request upload URL" && uploadRequestCalls == 2 {
						http.Error(w, "control plane unavailable", http.StatusServiceUnavailable)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"upload_url": server.URL + "/upload"})
				case "/upload":
					_, _ = io.Copy(io.Discard, r.Body)
					dataPlaneCalls++
					if test.failureStage == "upload data" && dataPlaneCalls == 2 {
						http.Error(w, "data plane unavailable", http.StatusBadGateway)
						return
					}
					_, _ = w.Write([]byte(`{"id":"tool-file-1"}`))
				case "/agent-stub/config/push":
					t.Error("final config push must not run after an item upload failure")
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			err := test.run(
				&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
				test.makeSources(t),
			)
			if err == nil {
				t.Fatal("config push succeeded, want second-item upload failure")
			}
			if !strings.Contains(err.Error(), test.wantItem) {
				t.Errorf("error = %q, want current item %q", err, test.wantItem)
			}
			if !strings.Contains(err.Error(), test.failureStage) {
				t.Errorf("error = %q, want stage %q", err, test.failureStage)
			}
			if uploadRequestCalls != 2 {
				t.Errorf("upload request calls = %d, want 2", uploadRequestCalls)
			}
			wantDataPlaneCalls := 2
			if test.failureStage == "request upload URL" {
				wantDataPlaneCalls = 1
			}
			if dataPlaneCalls != wantDataPlaneCalls {
				t.Errorf("data-plane calls = %d, want %d", dataPlaneCalls, wantDataPlaneCalls)
			}
		})
	}
}

func TestConfigPushFinalFailureIdentifiesOperationAndExplainsExpiry(t *testing.T) {
	tests := []struct {
		name       string
		makeSource func(*testing.T) string
		run        func(*Environment, string) error
		want       string
	}{
		{
			name: "file",
			makeSource: func(t *testing.T) string {
				path := filepath.Join(t.TempDir(), "guide.txt")
				if err := os.WriteFile(path, []byte("guide"), 0o600); err != nil {
					t.Fatalf("write config file: %v", err)
				}
				return path
			},
			run:  func(env *Environment, path string) error { return RunConfigFilesPush(env, []string{path}) },
			want: "push config files",
		},
		{
			name: "skill",
			makeSource: func(t *testing.T) string {
				dir := filepath.Join(t.TempDir(), "alpha")
				if err := os.MkdirAll(dir, 0o755); err != nil {
					t.Fatalf("create config skill: %v", err)
				}
				if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("# Alpha\n"), 0o600); err != nil {
					t.Fatalf("write config skill: %v", err)
				}
				return dir
			},
			run:  func(env *Environment, path string) error { return RunConfigSkillsPush(env, []string{path}) },
			want: "push config skills",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/agent-stub/files/upload-request":
					_ = json.NewEncoder(w).Encode(map[string]string{"upload_url": server.URL + "/upload"})
				case "/upload":
					_, _ = w.Write([]byte(`{"id":"tool-file-1"}`))
				case "/agent-stub/config/push":
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					_, _ = w.Write([]byte(`{"detail":{"code":"agent_stub_authorization_expired","message":"expired"}}`))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			err := test.run(
				&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
				test.makeSource(t),
			)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want operation %q", err, test.want)
			}
			if !strings.Contains(err.Error(), "start a new shell tool call") {
				t.Fatalf("error = %v, want expiry recovery guidance", err)
			}
		})
	}
}

func makeConfigFileSources(t *testing.T) []string {
	t.Helper()
	dir := t.TempDir()
	paths := []string{filepath.Join(dir, "first.txt"), filepath.Join(dir, "second.txt")}
	for _, path := range paths {
		if err := os.WriteFile(path, []byte(filepath.Base(path)), 0o600); err != nil {
			t.Fatalf("write config file: %v", err)
		}
	}
	return paths
}

func makeConfigSkillSources(t *testing.T) []string {
	t.Helper()
	dir := t.TempDir()
	paths := []string{filepath.Join(dir, "alpha"), filepath.Join(dir, "beta")}
	for _, path := range paths {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatalf("create config skill: %v", err)
		}
		if err := os.WriteFile(filepath.Join(path, "SKILL.md"), []byte("# "+filepath.Base(path)+"\n"), 0o600); err != nil {
			t.Fatalf("write config skill: %v", err)
		}
	}
	return paths
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

func captureConfigStdout(t *testing.T, run func() error) (string, error) {
	t.Helper()
	outputFile, err := os.CreateTemp(t.TempDir(), "config-stdout-*")
	if err != nil {
		t.Fatalf("create stdout capture: %v", err)
	}
	originalStdout := os.Stdout
	var runErr error
	func() {
		defer func() { os.Stdout = originalStdout }()
		os.Stdout = outputFile
		runErr = run()
	}()
	if err := outputFile.Close(); err != nil {
		t.Fatalf("close stdout capture: %v", err)
	}
	output, err := os.ReadFile(outputFile.Name())
	if err != nil {
		t.Fatalf("read stdout capture: %v", err)
	}
	return string(output), runErr
}
