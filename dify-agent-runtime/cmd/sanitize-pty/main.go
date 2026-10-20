// shellctl-sanitize-pty is a stdin→stdout PTY sanitizer used by tmux pipe-pane.
// It strips ANSI escape sequences, normalizes carriage-return progress lines,
// and performs incremental UTF-8 decoding.
package main

import (
	"flag"
	"github.com/langgenius/dify/dify-agent-runtime/internal/testscope"
	"io"
	"os"

	"github.com/langgenius/dify/dify-agent-runtime/internal/cmdutil"
	"github.com/langgenius/dify/dify-agent-runtime/internal/sanitize"
)

func main() {
	readyFile := flag.String("ready-file", "", "path to touch before reading stdin")
	nativeConfig := flag.String("native-config", "", "trusted native scope configuration")
	flag.Parse()
	var output io.Writer = os.Stdout
	if *nativeConfig != "" {
		writer, closeBudget, err := testscope.OpenOutputBudget(*nativeConfig, output)
		cmdutil.HandleError(err, 1, "native output budget")
		defer closeBudget()
		output = writer
	}

	cmdutil.HandleError(sanitize.Run(*readyFile, os.Stdin, output), 1, "sanitize-pty")
}
