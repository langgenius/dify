// shellctl-runner-exit persists a drained runner exit into the shellctl SQLite DB.
// It runs after the tmux output pipe reaches EOF and output.log is fully flushed.
package main

import (
	"flag"
	"fmt"

	"github.com/langgenius/dify/dify-agent-runtime/internal/cmdutil"
	runnerexit "github.com/langgenius/dify/dify-agent-runtime/internal/runner_exit"
)

func main() {
	stateDir := flag.String("state-dir", "", "shellctl state directory")
	jobID := flag.String("job-id", "", "job identifier")
	exitCode := flag.Int("exit-code", 0, "runner process exit code")
	endedAt := flag.String("ended-at", "", "ISO-8601 ended_at timestamp")
	busyTimeoutMs := flag.Int("sqlite-busy-timeout-ms", 5000, "SQLite busy timeout in milliseconds")
	flag.Parse()

	if *stateDir == "" || *jobID == "" || *endedAt == "" {
		cmdutil.HandleError(fmt.Errorf("missing flags"), 1, "--state-dir, --job-id, and --ended-at are required")
	}

	cmdutil.HandleError(
		runnerexit.RecordRunnerExit(*stateDir, *jobID, *exitCode, *endedAt, *busyTimeoutMs),
		1, "record runner exit",
	)
}
