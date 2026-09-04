// Package jobmode defines the execution modes shared by the shellctl server
// and runner.
package jobmode

import "fmt"

// Mode selects how the runner connects a job's standard streams.
type Mode string

const (
	PTY   Mode = "pty"
	Stdio Mode = "stdio"
)

// Parse validates a mode received at a process or API boundary. An empty value
// preserves the historical PTY behavior for callers that omit the mode.
func Parse(raw string) (Mode, error) {
	if raw == "" {
		return PTY, nil
	}

	mode := Mode(raw)
	switch mode {
	case PTY, Stdio:
		return mode, nil
	default:
		return "", fmt.Errorf("invalid job mode %q", raw)
	}
}
