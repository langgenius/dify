//go:build !linux

package testscope

import (
	"errors"
	"io"
)

// ErrUnsupportedPlatform is returned when isolated native scope execution is requested outside Linux.
var ErrUnsupportedPlatform = errors.New("native test scopes require Linux")

func OpenOutputBudget(string, io.Writer) (io.Writer, func(), error) {
	return nil, nil, ErrUnsupportedPlatform
}

func CheckOutputSpool(string, int64) error {
	return ErrUnsupportedPlatform
}
