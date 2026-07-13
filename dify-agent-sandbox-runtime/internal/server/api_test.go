package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// We can't fully test the Service without tmux, but we can test the HTTP
// layer wiring, error handling, and JSON serialization.

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, 200, HealthResponse{Status: "ok"})

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if w.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected application/json, got %s", w.Header().Get("Content-Type"))
	}

	var result HealthResponse
	json.NewDecoder(w.Body).Decode(&result)
	if result.Status != "ok" {
		t.Errorf("expected status=ok, got %s", result.Status)
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, 400, "bad_request", "missing field")

	if w.Code != 400 {
		t.Errorf("expected 400, got %d", w.Code)
	}

	var result ErrorResponse
	json.NewDecoder(w.Body).Decode(&result)
	if result.Error.Code != "bad_request" {
		t.Errorf("expected code=bad_request, got %s", result.Error.Code)
	}
	if result.Error.Message != "missing field" {
		t.Errorf("expected message='missing field', got %s", result.Error.Message)
	}
}

func TestWriteServerError(t *testing.T) {
	w := httptest.NewRecorder()
	err := NewServerError(404, "job_not_found", "Unknown job id")
	writeServerError(w, err)

	if w.Code != 404 {
		t.Errorf("expected 404, got %d", w.Code)
	}

	var result ErrorResponse
	json.NewDecoder(w.Body).Decode(&result)
	if result.Error.Code != "job_not_found" {
		t.Errorf("expected code=job_not_found, got %s", result.Error.Code)
	}
}

func TestWriteServerErrorGeneric(t *testing.T) {
	w := httptest.NewRecorder()
	writeServerError(w, &json.SyntaxError{Offset: 5})

	if w.Code != 500 {
		t.Errorf("expected 500, got %d", w.Code)
	}

	var result ErrorResponse
	json.NewDecoder(w.Body).Decode(&result)
	if result.Error.Code != "internal_error" {
		t.Errorf("expected code=internal_error, got %s", result.Error.Code)
	}
}

func TestAuthMiddlewareNoToken(t *testing.T) {
	// When no token configured, auth middleware should pass through
	handler := authMiddleware("")(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})

	req := httptest.NewRequest("GET", "/v1/jobs", nil)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200 without auth, got %d", w.Code)
	}
}

func TestAuthMiddlewareWithToken(t *testing.T) {
	handler := authMiddleware("secret")(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})

	// Without auth header
	req := httptest.NewRequest("GET", "/v1/jobs", nil)
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != 401 {
		t.Errorf("expected 401 without auth, got %d", w.Code)
	}

	// With correct auth header
	req = httptest.NewRequest("GET", "/v1/jobs", nil)
	req.Header.Set("Authorization", "Bearer secret")
	w = httptest.NewRecorder()
	handler(w, req)
	if w.Code != 200 {
		t.Errorf("expected 200 with correct auth, got %d", w.Code)
	}

	// With wrong auth header
	req = httptest.NewRequest("GET", "/v1/jobs", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	w = httptest.NewRecorder()
	handler(w, req)
	if w.Code != 401 {
		t.Errorf("expected 401 with wrong auth, got %d", w.Code)
	}
}

func TestHealthzHandler(t *testing.T) {
	// Create a handler with a nil service (healthz doesn't use it)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealthz)

	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, "ok") {
		t.Errorf("expected body to contain 'ok', got %s", body)
	}
}

func TestServerErrorFormat(t *testing.T) {
	err := NewServerError(422, "validation_error", "bad input")
	expected := "[422] validation_error: bad input"
	if err.Error() != expected {
		t.Errorf("expected %q, got %q", expected, err.Error())
	}
}

func TestIsNotFound(t *testing.T) {
	if !isNotFound(ErrJobNotFound) {
		t.Error("ErrJobNotFound should be detected as not found")
	}
	if isNotFound(NewServerError(500, "internal_error", "x")) {
		t.Error("500 error should not be detected as not found")
	}
}
