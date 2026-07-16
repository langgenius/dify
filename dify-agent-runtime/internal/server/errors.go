package server

import "fmt"

// ServerError is a structured error with HTTP status code and machine-readable code.
type ServerError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *ServerError) Error() string {
	return fmt.Sprintf("[%d] %s: %s", e.StatusCode, e.Code, e.Message)
}

// Common sentinel errors.
var ErrJobNotFound = &ServerError{StatusCode: 404, Code: "job_not_found", Message: "Unknown job id"}

// NewServerError creates a new ServerError.
func NewServerError(statusCode int, code, message string) *ServerError {
	return &ServerError{StatusCode: statusCode, Code: code, Message: message}
}
