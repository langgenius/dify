package coderuntime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

func GenerateCode(request GenerateCodeRequest, accessToken AccessToken) (*GenerateCodeResponse, error) {
	baseUrl := os.Getenv("CONSOLE_API_URL")
	url := baseUrl + "/console/api/rule-code-generate"

	jsonData, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("JSON encoding error: %v", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("request creation error: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken.Value)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request sending error: %v", err)
	}
	defer resp.Body.Close()

	var response GenerateCodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("response decoding error: %v", err)
	}

	return &response, nil
}

type GenerateCodeRequest struct {
	Instruction  string      `json:"instruction"`
	CodeLanguage string      `json:"code_language"`
	NoVariable   bool        `json:"no_variable"`
	ModelConfig  ModelConfig `json:"model_config"`
}
type AccessToken struct {
	Value string
}
type GenerateCodeResponse struct {
	Code     string `json:"code"`
	Error    string `json:"error"`
	Language string `json:"language"`
}

type ModelConfig struct {
	Provider         string           `json:"provider"`
	Name             string           `json:"name"`
	Mode             string           `json:"mode"`
	CompletionParams CompletionParams `json:"completion_params"`
}

type CompletionParams struct {
	Temperature      float64  `json:"temperature"`
	MaxTokens        int      `json:"max_tokens"`
	TopP             float64  `json:"top_p"`
	Echo             bool     `json:"echo"`
	Stop             []string `json:"stop"`
	PresencePenalty  float64  `json:"presence_penalty"`
	FrequencyPenalty float64  `json:"frequency_penalty"`
}
