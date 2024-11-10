package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Result string `json:"result"`
	Data   struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	} `json:"data"`
}

func Login(email, password string) (string, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	loginPayload := LoginRequest{
		Email:    email,
		Password: password,
	}

	loginJSON, err := json.Marshal(loginPayload)
	if err != nil {
		return "", fmt.Errorf("failed to convert to JSON: %w", err)
	}
	baseUrl := os.Getenv("CONSOLE_API_URL")
	loginReq, err := http.NewRequest("POST", baseUrl+"/console/api/login", bytes.NewBuffer(loginJSON))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	loginReq.Header.Set("Content-Type", "application/json")

	loginResp, err := client.Do(loginReq)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer loginResp.Body.Close()

	var loginResult LoginResponse
	if err := json.NewDecoder(loginResp.Body).Decode(&loginResult); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	if loginResult.Result != "success" {
		return "", fmt.Errorf("login failed")
	}

	return loginResult.Data.AccessToken, nil
}
