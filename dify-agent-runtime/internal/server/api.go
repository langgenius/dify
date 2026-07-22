package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
)

// Handler creates the HTTP handler (mux) for the shellctl API.
func Handler(svc *Service, config *Config) http.Handler {
	mux := http.NewServeMux()

	auth := authMiddleware(config.AuthToken)

	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("POST /v1/jobs/run", auth(handleRunJob(svc)))
	mux.HandleFunc("POST /v1/jobs/{job_id}/wait", auth(handleWaitJob(svc, config)))
	mux.HandleFunc("GET /v1/jobs/{job_id}/log/tail", auth(handleTailJob(svc, config)))
	mux.HandleFunc("GET /v1/jobs/{job_id}", auth(handleJobStatus(svc)))
	mux.HandleFunc("GET /v1/jobs", auth(handleListJobs(svc, config)))
	mux.HandleFunc("POST /v1/jobs/{job_id}/input", auth(handleInputJob(svc, config)))
	mux.HandleFunc("POST /v1/jobs/{job_id}/terminate", auth(handleTerminateJob(svc, config)))
	mux.HandleFunc("DELETE /v1/jobs/{job_id}", auth(handleDeleteJob(svc, config)))

	return requestLoggingMiddleware(recoveryMiddleware(mux))
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, HealthResponse{Status: HealthStatus})
}

func handleRunJob(svc *Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req RunJobRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, 400, "invalid_request", "Invalid JSON body")
			return
		}
		if req.Script == "" {
			writeError(w, 400, "invalid_request", "script is required")
			return
		}
		// Validate env
		if req.Env != nil {
			for name, value := range req.Env {
				if name == "" {
					writeError(w, 422, "validation_error", "env names must be non-empty")
					return
				}
				if strings.Contains(name, "=") {
					writeError(w, 422, "validation_error", fmt.Sprintf("env name must not contain '=': %q", name))
					return
				}
				if strings.Contains(name, "\x00") || strings.Contains(value, "\x00") {
					writeError(w, 422, "validation_error", "env entries must not contain NUL")
					return
				}
			}
		}

		result, err := svc.RunJob(&req)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func handleWaitJob(svc *Service, config *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue("job_id")
		var req WaitJobRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, 400, "invalid_request", "Invalid JSON body")
			return
		}
		if req.IdleFlushSeconds == 0 {
			req.IdleFlushSeconds = DefaultIdleFlushSeconds
		}
		result, err := svc.WaitJob(jobID, &req)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func handleTailJob(svc *Service, config *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue("job_id")
		outputLimit := config.DefaultOutputLimitBytes
		if v := r.URL.Query().Get("output_limit"); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
				outputLimit = parsed
			}
		}
		if outputLimit > config.MaxOutputLimitBytes {
			outputLimit = config.MaxOutputLimitBytes
		}
		result, err := svc.TailJob(jobID, outputLimit)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func handleJobStatus(svc *Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue("job_id")
		view, err := svc.GetJobStatus(jobID)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, view)
	}
}

func handleListJobs(svc *Service, config *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var status *JobStatusName
		if v := r.URL.Query().Get("status"); v != "" {
			s := JobStatusName(v)
			status = &s
		}
		limit := config.DefaultListLimit
		if v := r.URL.Query().Get("limit"); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		if limit > config.MaxListLimit {
			limit = config.MaxListLimit
		}

		result, err := svc.ListJobs(status, limit)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func handleInputJob(svc *Service, config *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue("job_id")
		var req InputJobRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, 400, "invalid_request", "Invalid JSON body")
			return
		}
		if req.IdleFlushSeconds == 0 {
			req.IdleFlushSeconds = DefaultIdleFlushSeconds
		}
		if req.Timeout == 0 {
			req.Timeout = DefaultTimeoutSeconds
		}
		result, err := svc.SendInput(jobID, &req)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func handleTerminateJob(svc *Service, config *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue("job_id")
		var req TerminateJobRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		graceSeconds := config.DefaultTerminateGraceSeconds
		if req.GraceSeconds != nil {
			graceSeconds = *req.GraceSeconds
		}
		view, err := svc.TerminateJob(jobID, graceSeconds)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, view)
	}
}

func handleDeleteJob(svc *Service, config *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobID := r.PathValue("job_id")
		force := r.URL.Query().Get("force") == "true"
		graceSeconds := config.DefaultTerminateGraceSeconds
		if v := r.URL.Query().Get("grace_seconds"); v != "" {
			if parsed, err := strconv.ParseFloat(v, 64); err == nil {
				graceSeconds = parsed
			}
		}
		result, err := svc.DeleteJob(jobID, force, graceSeconds)
		if err != nil {
			writeServerError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

// Middleware

// statusRecorder wraps ResponseWriter to capture the status code.
type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.statusCode = code
	sr.ResponseWriter.WriteHeader(code)
}

func requestLoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, statusCode: 200}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, rec.statusCode, time.Since(start).Round(time.Millisecond))
	})
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := debug.Stack()
				log.Printf("PANIC %s %s: %v\n%s", r.Method, r.URL.Path, rec, stack)
				writeError(w, 500, "internal_panic", fmt.Sprintf("internal server error: %v", rec))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func authMiddleware(token string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		if token == "" {
			return next // No auth configured
		}
		expected := "Bearer " + token
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != expected {
				writeError(w, 401, "unauthorized", "Missing or invalid bearer token")
				return
			}
			next(w, r)
		}
	}
}

// Response helpers

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorResponse{Error: ErrorDetail{Code: code, Message: message}})
}

func writeServerError(w http.ResponseWriter, err error) {
	if se, ok := err.(*ServerError); ok {
		log.Printf("ERROR [%d] %s: %s", se.StatusCode, se.Code, se.Message)
		writeError(w, se.StatusCode, se.Code, se.Message)
		return
	}
	log.Printf("ERROR [500] internal_error: %v", err)
	writeError(w, 500, "internal_error", err.Error())
}
