package coderuntime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type SandboxRequest struct {
	Language      string `json:"language"`
	Code          string `json:"code"`
	Preload       string `json:"preload,omitempty"`
	EnableNetwork bool   `json:"enable_network"`
}

type ExecutionResult struct {
	StatusCode int
	Body       string
	Error      error
}

func ExtractResult(response string) (string, error) {
	const resultTag = "<<RESULT>>"
	startIndex := strings.Index(response, resultTag) + len(resultTag)
	endIndex := strings.LastIndex(response, resultTag)

	if startIndex == -1 || endIndex == -1 {
		return "", fmt.Errorf("invalid result format")
	}

	jsonStr := response[startIndex:endIndex]

	var result map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return "", fmt.Errorf("failed to parse JSON: %v", err)
	}

	// Format output
	prettyJSON, err := json.MarshalIndent(result, "", "    ")
	if err != nil {
		return "", fmt.Errorf("failed to format JSON: %v", err)
	}

	return string(prettyJSON), nil
}

func ExecuteCode(request SandboxRequest, inputs map[string]interface{}) (ExecutionResult, error) {
	apiKey := os.Getenv("CODE_EXECUTION_API_KEY")
	endpoint := os.Getenv("CODE_EXECUTION_ENDPOINT")

	if apiKey == "" || endpoint == "" {
		fmt.Println("必要な環境変数が設定されていません")
		return ExecutionResult{}, fmt.Errorf("missing required environment variables")
	}
	var transformer TemplateTransformer
	switch request.Language {
	case "python3":
		transformer = NewPython3TemplateTransformer()
	case "javascript":
		transformer = NewJavaScriptTemplateTransformer()
	default:
		return ExecutionResult{}, fmt.Errorf("unsupported language: %s", request.Language)
	}
	// transformer := NewPython3TemplateTransformer()

	finalCode, preload, err := transformer.TransformCaller(request.Code, inputs)
	if err != nil {
		return ExecutionResult{}, fmt.Errorf("failed to transform code: %v", err)
	}

	execRequest := SandboxRequest{
		Language:      request.Language,
		Code:          finalCode,
		Preload:       preload,
		EnableNetwork: request.EnableNetwork,
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	jsonData, err := json.Marshal(execRequest)
	if err != nil {
		return ExecutionResult{}, fmt.Errorf("failed to convert to JSON: %v", err)
	}

	url := endpoint + "/v1/sandbox/run"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return ExecutionResult{}, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return ExecutionResult{}, fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ExecutionResult{}, fmt.Errorf("failed to read response: %v", err)
	}

	result := ExecutionResult{
		StatusCode: resp.StatusCode,
		Body:       string(body),
	}

	if resp.StatusCode == 200 {
		var response struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Data    struct {
				Error  string `json:"error"`
				Stdout string `json:"stdout"`
			} `json:"data"`
		}

		if err := json.Unmarshal(body, &response); err != nil {
			return result, fmt.Errorf("failed to parse response: %v", err)
		}

		if response.Data.Error != "" {
			result.Error = fmt.Errorf("execution error: %s", response.Data.Error)
		} else if prettyResult, err := ExtractResult(response.Data.Stdout); err != nil {
			result.Error = fmt.Errorf("failed to process result: %v", err)
		} else {
			result.Body = prettyResult
		}
	}

	return result, nil

}
