//go:build linux

package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"runtime"
	"syscall"

	"github.com/langgenius/dify/dify-agent-runtime/internal/cmdutil"
	"github.com/langgenius/dify/dify-agent-runtime/internal/testscope"
	"golang.org/x/sys/unix"
)

func configureNativeJobProcess(cmd *exec.Cmd) error {
	runtime.LockOSThread()
	cmd.SysProcAttr = &syscall.SysProcAttr{Cloneflags: unix.CLONE_NEWNS | unix.CLONE_NEWPID, Pdeathsig: syscall.SIGKILL}
	return nil
}

func prepareNativeJob(configPath, scriptPath string) (string, error) {
	data, err := os.ReadFile(configPath)
	cmdutil.HandleError(err, 125, "native scope configuration")
	var cfg testscope.WorkerConfig
	cmdutil.HandleError(json.Unmarshal(data, &cfg), 125, "native scope configuration")
	return testscope.PrepareJob(cfg, scriptPath)
}
