package sanitize

import (
	"bytes"
	"fmt"
	"io"
	"testing"
)

func TestPlainText(t *testing.T) {
	s := New()
	out := s.Feed([]byte("hello\nworld\n"))
	out = append(out, s.Flush()...)
	expected := "hello\nworld\n"
	if string(out) != expected {
		t.Errorf("got %q, want %q", string(out), expected)
	}
}

func TestStripCSI(t *testing.T) {
	// ESC [ 31 m = red color, ESC [ 0 m = reset
	input := []byte("\x1b[31mred\x1b[0m\n")
	s := New()
	out := s.Feed(input)
	out = append(out, s.Flush()...)
	expected := "red\n"
	if string(out) != expected {
		t.Errorf("got %q, want %q", string(out), expected)
	}
}

func TestCarriageReturnOverwrite(t *testing.T) {
	// Progress: "50%" CR "100%" LF -> only "100%" visible
	input := []byte("50%\r100%\n")
	s := New()
	out := s.Feed(input)
	out = append(out, s.Flush()...)
	expected := "100%\n"
	if string(out) != expected {
		t.Errorf("got %q, want %q", string(out), expected)
	}
}

func TestCRLF(t *testing.T) {
	input := []byte("line1\r\nline2\r\n")
	s := New()
	out := s.Feed(input)
	out = append(out, s.Flush()...)
	expected := "line1\nline2\n"
	if string(out) != expected {
		t.Errorf("got %q, want %q", string(out), expected)
	}
}

func TestOSCSequence(t *testing.T) {
	// OSC: ESC ] ... BEL
	input := []byte("\x1b]0;title\x07visible\n")
	s := New()
	out := s.Feed(input)
	out = append(out, s.Flush()...)
	expected := "visible\n"
	if string(out) != expected {
		t.Errorf("got %q, want %q", string(out), expected)
	}
}

func TestFlushUnterminatedLine(t *testing.T) {
	s := New()
	out := s.Feed([]byte("no newline"))
	out = append(out, s.Flush()...)
	expected := "no newline"
	if string(out) != expected {
		t.Errorf("got %q, want %q", string(out), expected)
	}
}

func TestInvalidUTF8(t *testing.T) {
	// 0xFF is not valid UTF-8, should be replaced
	s := New()
	out := s.Feed([]byte{0xFF, 'a', '\n'})
	out = append(out, s.Flush()...)
	expected := "\uFFFDa\n"
	if string(out) != expected {
		t.Errorf("got %q, want %q", string(out), expected)
	}
}

func TestUTF8AcrossFeedBoundaries(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"plain", "Hello, ¢世界 🌍�\n", "Hello, ¢世界 🌍�\n"},
		{"CSI", "\x1b[31m世界\x1b[0m 🌍\n", "世界 🌍\n"},
		{"OSC_BEL", "\x1b]0;世界 🌍\x07visible\n", "visible\n"},
		{"OSC_ST", "\x1b]0;世界 🌍\x1b\\visible\n", "visible\n"},
		{"CR", "50%\r世界 🌍\r\n", "世界 🌍\n"},
		{"invalid", "\xff\xe4A\n", "��A\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for split := 0; split <= len(tc.input); split++ {
				t.Run(fmt.Sprintf("split_%d", split), func(t *testing.T) {
					s := New()
					out := s.Feed([]byte(tc.input[:split]))
					out = append(out, s.Feed(nil)...)
					out = append(out, s.Feed([]byte(tc.input[split:]))...)
					out = append(out, s.Flush()...)
					if string(out) != tc.want {
						t.Errorf("got %q, want %q", out, tc.want)
					}
				})
			}
		})
	}
}

func TestFlushIncompleteUTF8(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"two_byte", "text\xc2", "text�"},
		{"three_byte", "text\xe4\xb8", "text��"},
		{"four_byte", "text\xf0\x9f\x8c", "text���"},
		{"CR", "old\r\xe4\xb8", "��"},
		{"CSI", "text\x1b[\xe4\xb8", "text"},
		{"OSC", "text\x1b]title\xe4\xb8", "text"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := New()
			out := s.Feed([]byte(tc.input))
			out = append(out, s.Flush()...)
			if string(out) != tc.want {
				t.Errorf("got %q, want %q", out, tc.want)
			}
			if out := s.Flush(); len(out) != 0 {
				t.Errorf("second Flush returned %q", out)
			}
		})
	}
}

type chunkedReader struct {
	data      []byte
	chunkSize int
}

func (r *chunkedReader) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	n := min(len(p), r.chunkSize, len(r.data))
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

func TestRunUTF8ReadBoundaries(t *testing.T) {
	const input = "Hello, ¢世界 🌍�\n"
	for _, chunkSize := range []int{1, 2, 3, 4, 5, len(input)} {
		t.Run(fmt.Sprintf("chunk_%d", chunkSize), func(t *testing.T) {
			reader := &chunkedReader{data: []byte(input), chunkSize: chunkSize}
			var output bytes.Buffer
			if err := Run("", reader, &output); err != nil {
				t.Fatal(err)
			}
			if got := output.String(); got != input {
				t.Errorf("got %q, want %q", got, input)
			}
		})
	}
}
