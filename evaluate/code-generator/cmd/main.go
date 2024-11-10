package main

import (
	"evaluate/auth"
	"evaluate/coderuntime"
	"evaluate/testdata"
	"fmt"
	"os"
	"strings"
	"syscall"

	"github.com/joho/godotenv"
	"golang.org/x/term"
)

func main() {
	if err := godotenv.Load("./.env"); err != nil {
		fmt.Printf("Failed to load .env file: %v\n", err)
		return
	}

	fmt.Print("Please enter your email address: ")
	var email string
	fmt.Scanln(&email)

	fmt.Print("Please enter your password: ")
	password, err := term.ReadPassword(int(syscall.Stdin))
	if err != nil {
		fmt.Printf("\nFailed to read password: %v\n", err)
		return
	}
	fmt.Println()
	accessToken, err := auth.Login(email, string(password))
	testCases, err := testdata.LoadTestCases("./testdata/testcases.json")
	if err != nil {
		fmt.Printf("Failed to load test cases: %v\n", err)
		return
	}

	metrics := testdata.NewTestMetrics()

	modelProvider := os.Getenv("MODEL_PROVIDER")
	modelName := os.Getenv("MODEL_NAME")

	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Printf("📱 Model Provider: %s\n", modelProvider)
	fmt.Printf("🤖 Model Name: %s\n", modelName)
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	for _, tc := range testCases {
		fmt.Printf("\nExecuting test case: %s\n", tc.Name)

		codegenRequest := coderuntime.GenerateCodeRequest{
			Instruction:  tc.Instruction,
			CodeLanguage: tc.CodeLanguage,
			NoVariable:   false,
			ModelConfig: coderuntime.ModelConfig{
				Provider: modelProvider,
				Name:     modelName,
				Mode:     "chat",
				CompletionParams: coderuntime.CompletionParams{
					Temperature:      0.7,
					MaxTokens:        0,
					TopP:             0,
					Echo:             false,
					Stop:             []string{},
					PresencePenalty:  0,
					FrequencyPenalty: 0,
				},
			},
		}

		generatedCode, err := coderuntime.GenerateCode(
			codegenRequest,
			coderuntime.AccessToken{
				Value: accessToken,
			},
		)
		if err != nil {
			metrics.AddResult(testdata.TestResult{
				TestCase: tc,
				Success:  false,
				Error:    err,
			})
			continue
		}

		language := generatedCode.Language
		if language == "python" {
			language += "3"
		}

		request := coderuntime.SandboxRequest{
			Language:      language,
			Code:          generatedCode.Code,
			EnableNetwork: true,
		}

		result, err := coderuntime.ExecuteCode(request, tc.Inputs)
		if result.Error != nil {
			metrics.AddResult(testdata.TestResult{
				TestCase: tc,
				Success:  false,
				Error:    result.Error,
			})
			continue
		}

		normalizedResult := strings.ReplaceAll(strings.ReplaceAll(result.Body, " ", ""), "\n", "")
		normalizedTruth := strings.ReplaceAll(strings.ReplaceAll(tc.GroundTruth, " ", ""), "\n", "")

		metrics.AddResult(testdata.TestResult{
			TestCase:    tc,
			Success:     normalizedResult == normalizedTruth,
			ActualValue: result.Body,
		})
	}

	metrics.Finish()
	metrics.PrintSummary()
}
