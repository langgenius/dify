package server

import "testing"

func TestServiceMethodsRejectMalformedJobIDBeforeUsingDependencies(t *testing.T) {
	svc := &Service{}
	jobID := "../../etc/passwd"

	tests := []struct {
		name string
		call func() error
	}{
		{name: "wait", call: func() error {
			_, err := svc.WaitJob(jobID, &WaitJobRequest{})
			return err
		}},
		{name: "tail", call: func() error {
			_, err := svc.TailJob(jobID, 1)
			return err
		}},
		{name: "status", call: func() error {
			_, err := svc.GetJobStatus(jobID)
			return err
		}},
		{name: "input", call: func() error {
			_, err := svc.SendInput(jobID, &InputJobRequest{})
			return err
		}},
		{name: "terminate", call: func() error {
			_, err := svc.TerminateJob(jobID, 0)
			return err
		}},
		{name: "delete", call: func() error {
			_, err := svc.DeleteJob(jobID, false, 0)
			return err
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.call()
			serverErr, ok := err.(*ServerError)
			if !ok {
				t.Fatalf("expected *ServerError, got %T (%v)", err, err)
			}
			if serverErr.StatusCode != 400 || serverErr.Code != "invalid_job_id" {
				t.Fatalf("unexpected error: %#v", serverErr)
			}
		})
	}
}
