//go:build !linux

package main

import (
	"os/exec"

	"github.com/langgenius/dify/dify-agent-runtime/internal/testscope"
)

func configureNativeJobProcess(*exec.Cmd) error {
	return testscope.ErrUnsupportedPlatform
}

func prepareNativeJob(string, string) (string, error) {
	return "", testscope.ErrUnsupportedPlatform
}
