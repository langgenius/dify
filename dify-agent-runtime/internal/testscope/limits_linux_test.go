//go:build linux

package testscope

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDelegationRequiresRealCgroupFilesystem(t *testing.T) {
	d := t.TempDir()
	for _, name := range []string{"cgroup.controllers", "cgroup.subtree_control", "cgroup.kill"} {
		if err := os.WriteFile(filepath.Join(d, name), []byte("cpu memory pids"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := ValidateDelegation(d); err == nil {
		t.Fatal("ordinary directory advertised as delegated cgroup")
	}
}
func TestLimitValidationRequiresEveryFiniteBound(t *testing.T) {
	l := validSpec().Limits
	for _, bad := range []Limits{{}, {CPUQuota: l.CPUQuota, MemoryBytes: l.MemoryBytes, PIDs: l.PIDs, FDs: l.FDs, WallSeconds: l.WallSeconds, InputBytes: l.InputBytes, OutputBytes: l.OutputBytes}} {
		if bad.Validate() == nil {
			t.Fatal("accepted omitted resource limit")
		}
	}
}
func TestOutputSpoolBoundCountsBothStreamsAcrossJobs(t *testing.T) {
	dir := t.TempDir()
	for _, job := range []string{"a", "b"} {
		if err := os.Mkdir(filepath.Join(dir, job), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, job, "output.log"), make([]byte, 80), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if CheckOutputSpool(dir, 200) != nil {
		t.Fatal("bounded spool refused")
	}
	if err := os.WriteFile(filepath.Join(dir, "a", "stderr.log"), make([]byte, 80), 0600); err != nil {
		t.Fatal(err)
	}
	if CheckOutputSpool(dir, 200) == nil {
		t.Fatal("accepted aggregate output overflow")
	}
}
