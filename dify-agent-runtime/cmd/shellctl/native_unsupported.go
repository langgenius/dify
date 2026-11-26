//go:build !linux

package main

import (
	"github.com/langgenius/dify/dify-agent-runtime/internal/server"
	"github.com/langgenius/dify/dify-agent-runtime/internal/testscope"
)

func runNativeSupervisor(*server.Config, testscope.Config) error {
	return testscope.ErrUnsupportedPlatform
}

func runNativeWorker() error {
	return testscope.ErrUnsupportedPlatform
}
