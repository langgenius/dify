package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestReadOutputWindowNonUTF8Advances(t *testing.T) {
	path := filepath.Join(t.TempDir(), "output.log")
	if err := os.WriteFile(path, []byte("prefix\xe9suffix\n"), 0600); err != nil {
		t.Fatal(err)
	}

	w1, err := ReadOutputWindow(path, 0, 16384)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("page 1: output=%q offset=%d truncated=%v", w1.Output, w1.Offset, w1.Truncated)
	if w1.Output != "prefix\uFFFDsuffix\n" {
		t.Errorf("page 1: expected output %q, got %q", "prefix\uFFFDsuffix\n", w1.Output)
	}
	if w1.Offset != 14 {
		t.Errorf("page 1: expected offset=14, got %d", w1.Offset)
	}
	if w1.Truncated {
		t.Errorf("page 1: expected truncated=false, got true")
	}

	// Paginating from the first offset must reach the suffix.
	w2, err := ReadOutputWindow(path, 6, 16384)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("page 2: output=%q offset=%d truncated=%v", w2.Output, w2.Offset, w2.Truncated)
	if !strings.Contains(w2.Output, "suffix") {
		t.Errorf("page 2: expected output to contain %q, got %q", "suffix", w2.Output)
	}
	if w2.Offset != 14 {
		t.Errorf("page 2: expected offset=14, got %d", w2.Offset)
	}
	if w2.Truncated {
		t.Errorf("page 2: expected truncated=false, got true")
	}
}

func TestReadOutputWindowTruncatedRuneAtEOF(t *testing.T) {
	path := filepath.Join(t.TempDir(), "output.log")
	// "世" = E4 B8 96; trailing E4 B8 is an incomplete rune at EOF.
	if err := os.WriteFile(path, []byte("ok\xe4\xb8"), 0600); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 0, 16384)
	if err != nil {
		t.Fatal(err)
	}
	if w.Output != "ok\uFFFD\uFFFD" {
		t.Errorf("expected output %q, got %q", "ok\uFFFD\uFFFD", w.Output)
	}
	if w.Offset != 4 {
		t.Errorf("expected offset=4, got %d", w.Offset)
	}
	if w.Truncated {
		t.Errorf("expected truncated=false, got true")
	}
	if !utf8.ValidString(w.Output) {
		t.Errorf("expected valid UTF-8 output, got %q", w.Output)
	}
}

func TestTailOutputWindowNonUTF8(t *testing.T) {
	path := filepath.Join(t.TempDir(), "output.log")
	content := append([]byte{0xff}, []byte(strings.Repeat("a", 100)+"\n")...)
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}

	w, err := TailOutputWindow(path, 1024)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("tail: output=%q (len=%d) offset=%d truncated=%v", w.Output, len(w.Output), w.Offset, w.Truncated)
	if !strings.Contains(w.Output, strings.Repeat("a", 100)) {
		t.Errorf("tail: expected output to contain 100 'a's, got %q", w.Output)
	}
	if w.Offset != len(content) {
		t.Errorf("tail: expected offset=%d, got %d", len(content), w.Offset)
	}
}
