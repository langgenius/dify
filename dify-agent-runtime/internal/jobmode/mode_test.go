package jobmode

import "testing"

func TestParse(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    Mode
		wantErr bool
	}{
		{name: "omitted", raw: "", want: PTY},
		{name: "pty", raw: "pty", want: PTY},
		{name: "stdio", raw: "stdio", want: Stdio},
		{name: "unknown", raw: "stdout", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.raw)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Parse(%q) error = %v, wantErr %v", tt.raw, err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("Parse(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}
