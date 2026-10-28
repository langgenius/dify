//go:build linux

package testscope

import (
	"io"
	"log"
	"os"
	"os/exec"
	"testing"
	"time"
)

// A retained worker must still write diagnostics after its launching manager
// dies. Pipes drained by the manager instead cause SIGPIPE on stdout/stderr.
func TestRetainedWorkerSurvivesManagerExit(t *testing.T) {
	const helperKey = "NATIVE_RETAINED_WORKER_HELPER"
	switch os.Getenv(helperKey) {
	case "manager":
		gate := os.NewFile(3, "worker-gate")
		report := os.NewFile(4, "worker-report")
		worker := exec.Command(os.Args[0], "-test.run=^TestRetainedWorkerSurvivesManagerExit$", "-test.timeout=10s")
		worker.Env = append(os.Environ(), helperKey+"=worker")
		worker.ExtraFiles = []*os.File{gate, report}
		if err := startRetainedWorker(worker); err != nil {
			t.Fatal(err)
		}
		// Do not wait: the production worker's lifetime extends past its manager.
		os.Exit(0)
	case "worker":
		gate := os.NewFile(3, "worker-gate")
		report := os.NewFile(4, "worker-report")
		var ready [1]byte
		if _, err := io.ReadFull(gate, ready[:]); err != nil {
			os.Exit(2)
		}
		// The parent signals only after the manager has exited and closed pipes.
		log.Print("retained worker stderr diagnostic")
		if _, err := os.Stdout.WriteString("retained worker stdout diagnostic\n"); err != nil {
			os.Exit(3)
		}
		if _, err := report.WriteString("survived"); err != nil {
			os.Exit(4)
		}
		os.Exit(0)
	}

	gateRead, gateWrite, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = gateRead.Close(); _ = gateWrite.Close() }()
	reportRead, reportWrite, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reportRead.Close(); _ = reportWrite.Close() }()
	manager := exec.Command(os.Args[0], "-test.run=^TestRetainedWorkerSurvivesManagerExit$", "-test.timeout=10s")
	manager.Env = append(os.Environ(), helperKey+"=manager")
	manager.ExtraFiles = []*os.File{gateRead, reportWrite}
	if output, err := manager.CombinedOutput(); err != nil {
		t.Fatalf("manager failed: %v %s", err, output)
	}
	_ = gateRead.Close()
	_ = reportWrite.Close()
	if _, err := gateWrite.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	if err := reportRead.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	report, err := io.ReadAll(reportRead)
	if err != nil || string(report) != "survived" {
		t.Fatalf("worker failed to survive logging after manager exit: report=%q err=%v", report, err)
	}
}
