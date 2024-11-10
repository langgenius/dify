package testdata

import (
	"fmt"
	"time"
)

type TestMetrics struct {
	TotalTests      int
	SuccessfulTests int
	FailedTests     int
	StartTime       time.Time
	EndTime         time.Time
	Results         []TestResult
}

func NewTestMetrics() *TestMetrics {
	return &TestMetrics{
		StartTime: time.Now(),
		Results:   make([]TestResult, 0),
	}
}

func (m *TestMetrics) AddResult(result TestResult) {
	m.TotalTests++
	if result.Success {
		m.SuccessfulTests++
	} else {
		m.FailedTests++
	}
	m.Results = append(m.Results, result)
}

func (m *TestMetrics) Finish() {
	m.EndTime = time.Now()
}

func (m *TestMetrics) PrintSummary() {
	duration := m.EndTime.Sub(m.StartTime)
	accuracy := float64(m.SuccessfulTests) / float64(m.TotalTests) * 100
	fmt.Printf("\n=== Detailed Results ===\n")
	for _, result := range m.Results {
		if result.Success {
			fmt.Printf("✅ %s\n", result.TestCase.Name)
		} else {
			fmt.Printf("❌ %s\n", result.TestCase.Name)
			if result.Error != nil {
				fmt.Printf("   Error: %v\n", result.Error)
			} else {
				fmt.Printf("   Expected: %s\n   Actual: %s\n",
					result.TestCase.GroundTruth, result.ActualValue)
			}
		}
	}
	fmt.Printf("\n=== Test Execution Summary ===\n")
	fmt.Printf("Total Tests: %d\n", m.TotalTests)
	fmt.Printf("Successful: %d\n", m.SuccessfulTests)
	fmt.Printf("Failed: %d\n", m.FailedTests)
	fmt.Printf("Accuracy: %.2f%%\n", accuracy)
	fmt.Printf("Execution Time: %.2f seconds\n", duration.Seconds())

}
