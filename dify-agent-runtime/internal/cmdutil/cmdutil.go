package cmdutil

import (
	"fmt"
	"os"
)

// HandleError checks err; if non-nil it prints a formatted message to stderr
// and exits with the given code.  Callers can use it as a one-liner:
//
//	cmdutil.HandleError(os.MkdirAll(dir, 0755), 125, "mkdir %s", dir)
func HandleError(err error, code int, format string, args ...any) {
	if err == nil {
		return
	}
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "shellctl: %s: %v\n", msg, err)
	os.Exit(code)
}
