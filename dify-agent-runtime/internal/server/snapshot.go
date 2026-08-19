package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"

	"github.com/langgenius/dify/dify-agent-runtime/internal/snapshot"
)

// Trailer names and values of the snapshot save completion protocol. A save
// stream is only trustworthy when it terminates cleanly AND carries
// X-Snapshot-Status: ok; a mid-stream failure aborts the connection instead,
// so truncation can never be mistaken for success.
const (
	TrailerSnapshotStatus = "X-Snapshot-Status"
	TrailerSnapshotSha256 = "X-Snapshot-Sha256"
	TrailerSnapshotBytes  = "X-Snapshot-Bytes"
	SnapshotStatusOK      = "ok"
)

// snapshotHandlers serves the native Home snapshot endpoints.
//
// SIZE CONTRACT: neither endpoint imposes a size limit. Consumers MUST bound
// the streams in their own logic — count bytes while reading a save stream
// and abort the connection at their cap; bound what they send to restore. In
// Dify EE the sandbox-gateway enforces this.
type snapshotHandlers struct {
	config *Config
	gate   sync.Mutex // single-flight: one snapshot operation per runtime
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
		empty, err := snapshot.HomeIsEmpty(home, h.config.HomeSnapshotExcludes)
		if err != nil {
			writeError(w, 500, "snapshot_failed", err.Error())
			return
		}
		if empty {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), h.config.SnapshotTimeout)
		defer cancel()

		w.Header().Set("Trailer", TrailerSnapshotStatus+", "+TrailerSnapshotSha256+", "+TrailerSnapshotBytes)
		w.Header().Set("Content-Type", "application/octet-stream")

		hcw := &hashCountWriter{w: w, h: sha256.New()}
		if err := snapshot.SaveHome(ctx, hcw, home, h.config.HomeSnapshotExcludes); err != nil {
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
}

func (h *snapshotHandlers) handleSnapshotRestore() http.HandlerFunc {
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

		ctx, cancel := context.WithTimeout(r.Context(), h.config.SnapshotTimeout)
		defer cancel()

		result, err := snapshot.RestoreHome(ctx, r.Body, home)
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
