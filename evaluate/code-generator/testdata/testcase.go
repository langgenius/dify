package testdata

import (
	"encoding/json"
	"os"
)

type TestCase struct {
	Name         string                 `json:"name"`
	Inputs       map[string]interface{} `json:"inputs"`
	Instruction  string                 `json:"instruction"`
	CodeLanguage string                 `json:"code_language"`
	GroundTruth  string                 `json:"ground_truth"`
}

type TestResult struct {
	TestCase    TestCase
	Success     bool
	ActualValue string
	Error       error
}

func LoadTestCases(filePath string) ([]TestCase, error) {
	file, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var testCases []TestCase
	if err := json.Unmarshal(file, &testCases); err != nil {
		return nil, err
	}

	return testCases, nil
}
