package agentcli

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var knowledgeUploadID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// KnowledgeQueryImageID accepts the existing local_file locator exposed in
// Agent App / Workflow inputs. It translates identity only: the API still
// authorizes the upload for the current caller on every query.
func KnowledgeQueryImageID(value string) (string, error) {
	if len(value) > 4096 {
		return "", fmt.Errorf("knowledge query image reference exceeds the input limit")
	}
	if encoded, found := strings.CutPrefix(value, "dify-file-ref:"); found {
		body, err := base64.URLEncoding.DecodeString(encoded)
		if err != nil {
			return "", fmt.Errorf("invalid knowledge query image reference")
		}
		var ref struct {
			RecordID string `json:"record_id"`
		}
		if err := json.Unmarshal(body, &ref); err != nil {
			return "", fmt.Errorf("invalid knowledge query image reference")
		}
		value = ref.RecordID
	}
	if !knowledgeUploadID.MatchString(value) {
		return "", fmt.Errorf("knowledge query images require a local_file upload UUID or canonical reference, not a URL")
	}
	return strings.ToLower(value), nil
}

// NewKnowledgeCommandID is unique per logical command. No transport retries are
// automatic: repeating an ID cannot duplicate upstream model work.
func NewKnowledgeCommandID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:]), nil
}

// RunKnowledge emits only complete bounded JSON. The request has no privileged
// routing fields. Context cancellation closes the request and cancels the Stub
// operation; redirects never forward the sandbox bearer token.
func RunKnowledge(ctx context.Context, env *Environment, payload map[string]any, output io.Writer) error {
	endpoint, err := ParseEndpoint(env.URL)
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if len(body) > 24*1024 {
		return fmt.Errorf("knowledge command exceeds the input limit")
	}
	ctx, cancel := context.WithTimeout(ctx, 65*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL+"/knowledge/commands", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+env.AuthJWE)
	client := &http.Client{Timeout: 65 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("knowledge command transport unavailable or cancelled")
	}
	defer func() { _ = resp.Body.Close() }()
	result, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024+1))
	if err != nil || len(result) > 64*1024 {
		return fmt.Errorf("knowledge response exceeds the output limit or is incomplete")
	}
	if err := checkAgentStubHTTPError(result, resp.StatusCode); err != nil {
		return err
	}
	var envelope struct {
		Version   int    `json:"version"`
		CommandID string `json:"command_id"`
		Command   string `json:"command"`
		Status    string `json:"status"`
	}
	if err := json.Unmarshal(result, &envelope); err != nil || envelope.Version != 1 ||
		envelope.CommandID != payload["command_id"] || envelope.Command != payload["command"] || envelope.Status != "ok" {
		return fmt.Errorf("incompatible knowledge CLI protocol; deploy matching Agent Stub and sandbox versions")
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, result); err != nil {
		return err
	}
	_, err = fmt.Fprintln(output, compact.String())
	return err
}
