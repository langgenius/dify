package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/snapshot"
)

const (
	TrailerSnapshotStatus = "X-Snapshot-Status"
	TrailerSnapshotSha256 = "X-Snapshot-Sha256"
	TrailerSnapshotBytes  = "X-Snapshot-Bytes"
	SnapshotStatusOK      = "ok"

	maxSaveRequestBytes = 64 << 10
	defaultStateTimeout = 180 * time.Second
)

type SaveRequest struct {
	Excludes []string `json:"excludes"`
}

func decodeSaveExcludes(body io.Reader) ([]string, error) {
	var req SaveRequest
	if err := json.NewDecoder(io.LimitReader(body, maxSaveRequestBytes)).Decode(&req); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		return nil, err
	}
	return req.Excludes, nil
}

// snapshotHandlers serializes Home Snapshot and cold state archive operations.
//
// SIZE CONTRACT: these endpoints impose no archive size limit. Consumers MUST bound
// the streams in their own logic.
type snapshotHandlers struct {
	config *Config
	gate   sync.Mutex
}

func newSnapshotHandlers(config *Config) *snapshotHandlers {
	return &snapshotHandlers{config: config}
}

// resolveHome fails loudly when $HOME is unset or not a directory — never
// degrade to a guessed or relative path.
func (h *snapshotHandlers) resolveHome() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	info, err := os.Stat(home)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("home is not a directory")
	}
	return home, nil
}

func (h *snapshotHandlers) handleSnapshotSave() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		excludes, err := decodeSaveExcludes(r.Body)
		if err != nil {
			writeError(w, 400, "invalid_request", err.Error())
			return
		}

		h.saveArchive(w, r, h.config.SnapshotTimeout, func(ctx context.Context, dst io.Writer, home string) error {
			return snapshot.SaveHome(ctx, dst, home, excludes)
		})
	}
}

func (h *snapshotHandlers) handleStateSave() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.saveArchive(w, r, h.stateTimeout(), func(ctx context.Context, dst io.Writer, home string) error {
			return snapshot.SaveState(ctx, dst, home, h.config.WorkspaceDir, h.config.StateDir, h.config.RuntimeDir)
		})
	}
}

func (h *snapshotHandlers) stateTimeout() time.Duration {
	return max(defaultStateTimeout, h.config.SnapshotTimeout)
}

func (h *snapshotHandlers) saveArchive(w http.ResponseWriter, r *http.Request, timeout time.Duration, save func(context.Context, io.Writer, string) error) {
	if !h.gate.TryLock() {
		writeError(w, 409, "snapshot_busy", "another snapshot operation is in progress")
		return
	}
	defer h.gate.Unlock()

	home, err := h.resolveHome()
	if err != nil {
		writeError(w, 500, "home_unavailable", err.Error())
		return
	}
	rc := http.NewResponseController(w)
	if err := rc.SetWriteDeadline(time.Now().Add(timeout)); err != nil {
		log.Printf("WARN snapshot save: set write deadline: %v", err)
	}

	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	w.Header().Set("Trailer", TrailerSnapshotStatus+", "+TrailerSnapshotSha256+", "+TrailerSnapshotBytes)
	w.Header().Set("Content-Type", "application/octet-stream")

	hcw := &hashCountWriter{w: w, h: sha256.New()}
	if err := save(ctx, hcw, home); err != nil {
		log.Printf("ERROR snapshot save: %v", err)
		if hcw.n == 0 {
			w.Header().Del("Trailer")
			writeError(w, 500, "snapshot_failed", err.Error())
			return
		}
		panic(http.ErrAbortHandler)
	}
	w.Header().Set(TrailerSnapshotStatus, SnapshotStatusOK)
	w.Header().Set(TrailerSnapshotSha256, hex.EncodeToString(hcw.h.Sum(nil)))
	w.Header().Set(TrailerSnapshotBytes, strconv.FormatInt(hcw.n, 10))
}

func (h *snapshotHandlers) handleSnapshotRestore() http.HandlerFunc {
	return h.restoreArchive(h.config.SnapshotTimeout, snapshot.RestoreHome)
}

func (h *snapshotHandlers) handleStateRestore() http.HandlerFunc {
	return h.restoreArchive(h.stateTimeout(), func(ctx context.Context, src io.Reader, home string) (snapshot.RestoreResult, error) {
		return snapshot.RestoreState(ctx, src, home, h.config.WorkspaceDir, h.config.StateDir, h.config.RuntimeDir)
	})
}

func (h *snapshotHandlers) restoreArchive(timeout time.Duration, restore func(context.Context, io.Reader, string) (snapshot.RestoreResult, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.gate.TryLock() {
			writeError(w, 409, "snapshot_busy", "another snapshot operation is in progress")
			return
		}
		defer h.gate.Unlock()

		home, err := h.resolveHome()
		if err != nil {
			writeError(w, 500, "home_unavailable", err.Error())
			return
		}

		rc := http.NewResponseController(w)
		if err := rc.SetReadDeadline(time.Now().Add(timeout)); err != nil {
			log.Printf("WARN snapshot restore: set read deadline: %v", err)
		}

		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		result, err := restore(ctx, r.Body, home)
		if err != nil {
			log.Printf("ERROR snapshot restore: %v", err)
			if errors.Is(err, snapshot.ErrMalformed) {
				writeError(w, 400, "archive_malformed", err.Error())
				return
			}
			writeError(w, 500, "restore_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, RestoreResponse{
			Entries:      result.Entries,
			BytesWritten: result.BytesWritten,
		})
	}
}

// hashCountWriter passes bytes through while hashing and counting them, so
// success trailers can carry the digest without buffering anything.
type hashCountWriter struct {
	w io.Writer
	h hash.Hash
	n int64
}

func (hc *hashCountWriter) Write(p []byte) (int, error) {
	n, err := hc.w.Write(p)
	hc.n += int64(n)
	_, _ = hc.h.Write(p[:n])
	return n, err
}
