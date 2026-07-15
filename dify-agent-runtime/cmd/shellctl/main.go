// shellctl is the main server binary that exposes a REST API for managing
// tmux-backed shell jobs inside a sandbox container.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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
	// Parse CLI flags
	serveCmd := flag.NewFlagSet("serve", flag.ExitOnError)
	listen := serveCmd.String("listen", "", "address to listen on (host:port)")
	stateDir := serveCmd.String("state-dir", "", "state directory path")
	token := serveCmd.String("token", "", "bearer auth token")

	if len(os.Args) < 2 || os.Args[1] != "serve" {
		fmt.Fprintf(os.Stderr, "Usage: shellctl serve [flags]\n")
		return nil
	}
	if err := serveCmd.Parse(os.Args[2:]); err != nil {
		return err
	}

	// Build config
	config := server.DefaultConfig()
	if *listen != "" {
		config.Listen = *listen
	}
	if *stateDir != "" {
		config.StateDir = *stateDir
	}
	if *token != "" {
		config.AuthToken = *token
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
