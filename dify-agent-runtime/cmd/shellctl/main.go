// shellctl is the main server binary that exposes a REST API for managing
// tmux-backed shell jobs inside a sandbox container.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/langgenius/dify/dify-agent-runtime/internal/testscope"
	"golang.org/x/sys/unix"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/server"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "shellctl: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 && os.Args[1] == "native-worker" {
		return runNativeWorker()
	}

	// Parse CLI flags
	serveCmd := flag.NewFlagSet("serve", flag.ExitOnError)
	listen := serveCmd.String("listen", "", "address to listen on (host:port)")
	stateDir := serveCmd.String("state-dir", "", "state directory path")
	native := serveCmd.Bool("native-test-supervisor", false, "serve isolated native-test scopes")
	cgroupRoot := serveCmd.String("native-cgroup-root", "", "dedicated delegated finite cgroup v2 root")
	snapshotRoot := serveCmd.String("native-snapshot-root", "", "trusted immutable snapshot root")
	mediators := serveCmd.String("native-mediators", "", "deployment-owned exact private IP:port broker destinations")
	inputRoot := serveCmd.String("native-input-root", "", "trusted immutable input-file root")
	token := serveCmd.String("token", "", "bearer auth token")
	requireAuthToken := serveCmd.Bool("require-auth-token", false, "require a nonblank bearer auth token")

	if len(os.Args) < 2 || os.Args[1] != "serve" {
		fmt.Fprintf(os.Stderr, "Usage: shellctl serve [flags]\n")
		return nil
	}
	if err := serveCmd.Parse(os.Args[2:]); err != nil {
		return err
	}

	// Build config
	config, err := server.DefaultConfig()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	if *listen != "" {
		config.Listen = *listen
	}
	if *stateDir != "" {
		config.StateDir = *stateDir
	}
	if *token != "" {
		config.AuthToken = *token
	}
	if *requireAuthToken && strings.TrimSpace(config.AuthToken) == "" {
		return fmt.Errorf("auth token is required: set SHELLCTL_AUTH_TOKEN or --token")
	}

	if *native {
		if os.Getuid() == 0 {
			return fmt.Errorf("native supervisor requires a dedicated unprivileged UID")
		}
		if err := testscope.VerifyBootstrapPolicy(); err != nil {
			return err
		}
		if config.AuthToken == "" {
			return fmt.Errorf("native supervisor requires authentication")
		}
		if err := testscope.ValidateDelegation(*cgroupRoot); err != nil {
			return err
		}
		if err := os.MkdirAll(config.StateDir, 0700); err != nil {
			return err
		}
		db, err := server.OpenDB(config.DBPath(), config.SQLiteBusyTimeoutMs)
		if err != nil {
			return err
		}
		defer func() { _ = db.Close() }()
		if err = db.InitSchema(); err != nil {
			return err
		}
		if err = db.EnableNativeDurability(); err != nil {
			return err
		}
		manager := testscope.NewManager(testscope.Config{AuthToken: config.AuthToken, StateDir: config.StateDir, CgroupRoot: *cgroupRoot, SnapshotRoot: *snapshotRoot, InputRoot: *inputRoot, Mediators: strings.Split(*mediators, ",")}, db.NativeScopeStore())
		if err = manager.Reconcile(); err != nil {
			return err
		}
		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for range ticker.C {
				_ = manager.Reconcile()
			}
		}()
		return http.ListenAndServe(config.Listen, manager.Handler())
	}
	// Initialize service
	svc := server.NewService(config)
	if err := svc.Initialize(); err != nil {
		return fmt.Errorf("initialize: %w", err)
	}
	defer svc.Shutdown()

	svc.StartBackgroundGC()
	svc.StartBackgroundPipeMonitor()

	// Create HTTP server
	handler := server.Handler(svc, config)
	srv := &http.Server{
		Addr:         config.Listen,
		Handler:      handler,
		ReadTimeout:  0, // Long-poll requires no read timeout
		WriteTimeout: 0,
	}

	// Graceful shutdown on signal
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Println("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("shellctl serving on %s", config.Listen)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}
	return nil
}

func runNativeWorker() (workerErr error) {
	// The original inherited descriptors are not CLOEXEC until explicitly marked.
	// Mark before launching the readiness probe or any existing tmux/runner child.
	unix.CloseOnExec(3)
	unix.CloseOnExec(4)
	if len(os.Args) != 3 {
		return fmt.Errorf("invalid native worker arguments")
	}
	stage := "config-read"
	ready := os.NewFile(4, "readiness")
	defer func() {
		if workerErr != nil {
			workerErr = testscope.WorkerSetupFailure(stage, workerErr)
			_, _ = ready.Write([]byte(workerErr.Error()))
		}
		_ = ready.Close()
	}()
	data, err := os.ReadFile(os.Args[2])
	if err != nil {
		return err
	}
	var worker testscope.WorkerConfig
	stage = "config-decode"
	if err = json.Unmarshal(data, &worker); err != nil {
		return err
	}
	stage = "prepare"
	if err = testscope.PrepareWorker(worker); err != nil {
		return err
	}
	stage = "proxy"
	if len(worker.Spec.NetworkTargets) > 0 {
		if err = testscope.StartWorkerProxy(filepath.Join(worker.Directory, "broker.sock")); err != nil {
			return err
		}
	}
	// Exercise the actual strict runner before reporting a usable scope.
	probe := filepath.Join(worker.Directory, "spool", "probe")
	stage = "probe-script"
	if err = os.WriteFile(probe, []byte("exit 0\n"), 0600); err != nil {
		return err
	}
	command := exec.Command("shellctl-runner", "--exec", "--native-scope", os.Args[2], probe, "/workspace")
	command.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/home/dify"}
	command.SysProcAttr = &syscall.SysProcAttr{Cloneflags: unix.CLONE_NEWNS | unix.CLONE_NEWPID}
	stage = "probe-exec"
	if err = command.Run(); err != nil {
		return fmt.Errorf("strict native runner probe failed: %w", err)
	}
	_ = os.Remove(probe)
	// Namespace PID1 expiry terminates all descendants, even after control restart.
	time.AfterFunc(time.Until(worker.Spec.Deadline), func() { os.Exit(124) })
	stage = "service-default"
	config, err := server.DefaultConfig()
	if err != nil {
		return err
	}
	config.AuthToken = worker.ControlToken
	config.StateDir = filepath.Join(worker.Directory, "state")
	config.RuntimeDir = filepath.Join(worker.Directory, "runtime")
	config.NativeJobsDir = filepath.Join(worker.Directory, "spool")
	config.NativeScopeConfigPath = os.Args[2]
	config.NativeOutputBytes = worker.Spec.Limits.OutputBytes
	config.NativeScopeID = worker.Spec.ScopeID
	config.NativeScopeGeneration = worker.Spec.Generation
	config.DefaultCwd = "/workspace"
	config.GCFinishedJobRetention = time.Hour
	svc := server.NewService(config)
	stage = "service-initialize"
	if err = svc.Initialize(); err != nil {
		return err
	}
	defer svc.Shutdown()
	svc.StartBackgroundPipeMonitor()
	go func() {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			_, violation := os.Stat(filepath.Join(worker.Directory, "violation"))
			if err := testscope.CheckOutputSpool(config.JobsDir(), worker.Spec.Limits.OutputBytes); err != nil || violation == nil {
				_ = os.WriteFile(filepath.Join(worker.Directory, "violation"), []byte("native_scope_output_limit_exceeded"), 0600)
				os.Exit(125)
			}
		}
	}()
	file := os.NewFile(3, "control-listener")
	stage = "control-listener"
	listener, err := net.FileListener(file)
	_ = file.Close()
	if err != nil {
		return err
	}
	defer func() { _ = listener.Close() }()
	stage = "ready-write"
	if _, err = ready.Write([]byte("ready")); err != nil {
		return err
	}
	_ = ready.Close()
	return (&http.Server{Handler: server.Handler(svc, config), ReadHeaderTimeout: 5 * time.Second}).Serve(listener)
}
