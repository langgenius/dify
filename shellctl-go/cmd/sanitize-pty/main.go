// shellctl-sanitize-pty is a stdin→stdout PTY sanitizer used by tmux pipe-pane.
// It strips ANSI escape sequences, normalizes carriage-return progress lines,
// and performs incremental UTF-8 decoding.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/langgenius/dify/shellctl-go/internal/sanitize"
)

func main() {
	readyFile := flag.String("ready-file", "", "path to touch before reading stdin")
	flag.Parse()

	if err := sanitize.Run(*readyFile, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "shellctl-sanitize-pty: %v\n", err)
		os.Exit(1)
	}
}
