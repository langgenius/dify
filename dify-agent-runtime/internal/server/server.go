// Package server implements the shellctl HTTP API and job lifecycle service.
//
// This is the Go equivalent of shellctl/server/ in the Python implementation.
// It manages tmux-backed shell jobs with SQLite persistence and provides
// REST endpoints for run, wait, input, terminate, and delete operations.
package server
