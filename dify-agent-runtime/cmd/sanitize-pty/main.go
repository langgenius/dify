// shellctl-sanitize-pty is a stdin→stdout PTY sanitizer used by tmux pipe-pane.
// It strips ANSI escape sequences, normalizes carriage-return progress lines,
// and performs incremental UTF-8 decoding.
package main

import (
	"flag"
	"os"

	"github.com/langgenius/dify/dify-agent-runtime/internal/cmdutil"
	"github.com/langgenius/dify/dify-agent-runtime/internal/sanitize"
)

func main() {
	readyFile := flag.String("ready-file", "", "path to touch before reading stdin")
	flag.Parse()

	cmdutil.HandleError(sanitize.Run(*readyFile, os.Stdin, os.Stdout), 1, "sanitize-pty")
}
