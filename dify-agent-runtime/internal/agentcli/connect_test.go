package agentcli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunConnectExplainsExpiredAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agent-stub/connections" {
			http.NotFound(w, r)
			return
		}
		var payload struct {
			Argv []string `json:"argv"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode connect request: %v", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if got, want := strings.Join(payload.Argv, " "), "echo hello"; got != want {
			t.Errorf("argv = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"detail":{"code":"agent_stub_authorization_expired","message":"Agent Stub authorization expired after 5 minutes; start a new shell tool call and retry the command."}}`))
	}))
	defer server.Close()

	err := RunConnect(
		&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
		[]string{"echo", "hello"},
		false,
	)
	if err == nil {
		t.Fatal("RunConnect succeeded, want expired authorization failure")
	}
	for _, want := range []string{
		"agent stub connect failed",
		"expired after 5 minutes",
		"will not refresh automatically",
		"start a new shell tool call",
		"retry the command",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want substring %q", err, want)
		}
	}
}
