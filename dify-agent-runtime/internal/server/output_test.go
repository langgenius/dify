package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestReadOutputWindowEmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 0, 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != "" {
		t.Errorf("expected empty output, got %q", w.Output)
	}
	if w.Offset != 0 {
		t.Errorf("expected offset=0, got %d", w.Offset)
	}
	if w.Truncated {
		t.Error("expected truncated=false")
	}
}

func TestReadOutputWindowNonexistentFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nonexistent.log")

	w, err := ReadOutputWindow(path, 0, 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != "" {
		t.Errorf("expected empty output, got %q", w.Output)
	}
}

func TestReadOutputWindowFullContent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := "hello\nworld\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 0, 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != content {
		t.Errorf("expected %q, got %q", content, w.Output)
	}
	if w.Truncated {
		t.Error("expected truncated=false")
	}
}

func TestReadOutputWindowWithOffset(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := "hello\nworld\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 6, 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != "world\n" {
		t.Errorf("expected 'world\\n', got %q", w.Output)
	}
	if w.Offset != len(content) {
		t.Errorf("expected offset=%d, got %d", len(content), w.Offset)
	}
}

func TestReadOutputWindowTruncated(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := "0123456789"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	// Read only 5 bytes
	w, err := ReadOutputWindow(path, 0, 5)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != "01234" {
		t.Errorf("expected '01234', got %q", w.Output)
	}
	if !w.Truncated {
		t.Error("expected truncated=true")
	}
	if w.Offset != 5 {
		t.Errorf("expected offset=5, got %d", w.Offset)
	}
}

func TestReadOutputWindowOffsetExceedsSize(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	if err := os.WriteFile(path, []byte("short"), 0644); err != nil {
		t.Fatal(err)
	}

	_, err := ReadOutputWindow(path, 100, 1024)
	if err == nil {
		t.Error("expected error for offset > size")
	}
}

func TestReadOutputWindowOffsetAtEnd(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := "hello"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, len(content), 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != "" {
		t.Errorf("expected empty output at end, got %q", w.Output)
	}
	if w.Offset != len(content) {
		t.Errorf("expected offset=%d, got %d", len(content), w.Offset)
	}
}

func TestReadOutputWindowMultibyteUTF8(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := "hello 世界\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 0, 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != content {
		t.Errorf("expected %q, got %q", content, w.Output)
	}
}

func TestReadOutputWindowMultibyteTruncated(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	// "世" = 3 bytes (E4 B8 96), "界" = 3 bytes (E7 95 8C)
	content := "世界"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	// Read only 4 bytes — should not split a multibyte char
	w, err := ReadOutputWindow(path, 0, 4)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	// Should get "世" (3 bytes), not partial "界"
	if w.Output != "世" {
		t.Errorf("expected '世', got %q", w.Output)
	}
	if !w.Truncated {
		t.Error("expected truncated=true")
	}
}

func TestTailOutputWindow(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := "line1\nline2\nline3\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	w, err := TailOutputWindow(path, 100)
	if err != nil {
		t.Fatalf("TailOutputWindow: %v", err)
	}
	if w.Output != content {
		t.Errorf("expected %q, got %q", content, w.Output)
	}
}

func TestTailOutputWindowLimited(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := "0123456789"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	w, err := TailOutputWindow(path, 5)
	if err != nil {
		t.Fatalf("TailOutputWindow: %v", err)
	}
	if w.Output != "56789" {
		t.Errorf("expected '56789', got %q", w.Output)
	}
}

func TestTailOutputWindowNonexistent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nonexistent.log")

	w, err := TailOutputWindow(path, 100)
	if err != nil {
		t.Fatalf("TailOutputWindow: %v", err)
	}
	if w.Output != "" {
		t.Errorf("expected empty, got %q", w.Output)
	}
}

func TestTailOutputWindowEmpty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.log")
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}

	w, err := TailOutputWindow(path, 100)
	if err != nil {
		t.Fatalf("TailOutputWindow: %v", err)
	}
	if w.Output != "" {
		t.Errorf("expected empty, got %q", w.Output)
	}
}

func TestIsUTF8Continuation(t *testing.T) {
	// ASCII bytes are not continuation bytes
	if isUTF8Continuation('a') {
		t.Error("'a' should not be a continuation byte")
	}
	// 0x80-0xBF are continuation bytes
	if !isUTF8Continuation(0x80) {
		t.Error("0x80 should be a continuation byte")
	}
	if !isUTF8Continuation(0xBF) {
		t.Error("0xBF should be a continuation byte")
	}
	// 0xC0 is not a continuation byte (it's a lead byte)
	if isUTF8Continuation(0xC0) {
		t.Error("0xC0 should not be a continuation byte")
	}
}

func TestAdvanceToUTF8Boundary(t *testing.T) {
	// "世" = E4 B8 96, continuation bytes at index 1 and 2
	data := []byte{0xE4, 0xB8, 0x96, 0x41} // 世 + A
	// Start at 1, should advance to 3 (the 'A')
	result := advanceToUTF8Boundary(data, 1)
	if result != 3 {
		t.Errorf("expected 3, got %d", result)
	}
	// Start at 0 (lead byte), should stay at 0
	result = advanceToUTF8Boundary(data, 0)
	if result != 0 {
		t.Errorf("expected 0, got %d", result)
	}
}

func TestReadOutputWindowNonUTF8AdvancesAndPreservesOutput(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	// Contains Latin-1 0xE9, invalid 0xFF, and truncated lead 0xE4 0xB8 before ASCII.
	content := []byte("prefix\xe9mid\xff\xe4\xb8suffix\n")
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 0, 16384)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	want := "prefix\uFFFDmid\uFFFD\uFFFD\uFFFDsuffix\n"
	if w.Output != want {
		t.Errorf("expected %q, got %q", want, w.Output)
	}
	if !utf8.ValidString(w.Output) {
		t.Errorf("expected valid UTF-8 output, got %q", w.Output)
	}
	if w.Offset != len(content) {
		t.Errorf("expected offset=%d, got %d", len(content), w.Offset)
	}
	if w.Truncated {
		t.Error("expected truncated=false")
	}
}

func TestReadOutputWindowNonUTF8PaginationNoStall(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := []byte("prefix\xe9suffix\n")
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	// Paginate with a small limit so a page boundary lands directly on 0xE9.
	var combined strings.Builder
	offset := 0
	for step := 0; step < len(content)+1; step++ {
		w, err := ReadOutputWindow(path, offset, 6)
		if err != nil {
			t.Fatalf("step %d ReadOutputWindow(offset=%d): %v", step, offset, err)
		}
		if !utf8.ValidString(w.Output) {
			t.Fatalf("step %d output is not valid UTF-8: %q", step, w.Output)
		}
		if w.Offset <= offset {
			t.Fatalf("step %d stalled at offset=%d (output=%q truncated=%v)", step, w.Offset, w.Output, w.Truncated)
		}
		combined.WriteString(w.Output)
		offset = w.Offset
		if !w.Truncated {
			break
		}
	}

	if offset != len(content) {
		t.Fatalf("expected final offset=%d, got %d", len(content), offset)
	}
	want := "prefix\uFFFDsuffix\n"
	if combined.String() != want {
		t.Errorf("expected %q, got %q", want, combined.String())
	}
}

func TestReadOutputWindowSmallLimitOnInvalidByteAdvances(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := []byte{0xFF, 'a'}
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	// Limit smaller than the 3-byte UTF-8 encoding of U+FFFD must still advance.
	w1, err := ReadOutputWindow(path, 0, 2)
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if w1.Output != "\uFFFD" || w1.Offset != 1 || !w1.Truncated {
		t.Fatalf("unexpected page 1: %+v", w1)
	}

	w2, err := ReadOutputWindow(path, w1.Offset, 2)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if w2.Output != "a" || w2.Offset != 2 || w2.Truncated {
		t.Fatalf("unexpected page 2: %+v", w2)
	}
}

func TestReadOutputWindowLiteralReplacementChar(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	content := []byte("a\uFFFDb")
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 0, 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != "a\uFFFDb" || w.Offset != len(content) || w.Truncated {
		t.Fatalf("unexpected result: %+v", w)
	}
}

func TestReadOutputWindowTruncatedMultibyteAtEOF(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	// Incomplete 3-byte UTF-8 sequence at EOF.
	content := []byte{'o', 'k', 0xE4, 0xB8}
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	w, err := ReadOutputWindow(path, 0, 1024)
	if err != nil {
		t.Fatalf("ReadOutputWindow: %v", err)
	}
	if w.Output != "ok\uFFFD\uFFFD" || w.Offset != len(content) || w.Truncated {
		t.Fatalf("unexpected result: %+v", w)
	}
}

func TestTailOutputWindowNonUTF8PreservesTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	suffix := strings.Repeat("a", 100) + "\n"
	content := append([]byte{0xFF}, []byte(suffix)...)
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	w, err := TailOutputWindow(path, 1024)
	if err != nil {
		t.Fatalf("TailOutputWindow: %v", err)
	}
	want := "\uFFFD" + suffix
	if w.Output != want {
		t.Errorf("expected %q, got %q", want, w.Output)
	}
	if !utf8.ValidString(w.Output) {
		t.Errorf("expected valid UTF-8 tail, got %q", w.Output)
	}
	if w.Offset != len(content) {
		t.Errorf("expected offset=%d, got %d", len(content), w.Offset)
	}
	if w.Truncated {
		t.Error("expected truncated=false")
	}
}

func TestReadOutputWindowContinuationRunBeforeMultibytePreservesRune(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.log")
	// 4 continuation bytes followed by 3-byte '世' (E4 B8 96).
	// With limit=2, readSize=6 reads the 4 continuation bytes plus 2 bytes of '世'.
	content := []byte{0x80, 0x80, 0x80, 0x80, 0xE4, 0xB8, 0x96}
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}

	w1, err := ReadOutputWindow(path, 0, 2)
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if w1.Output != "" || w1.Offset != 4 || !w1.Truncated {
		t.Fatalf("unexpected page 1: %+v", w1)
	}

	w2, err := ReadOutputWindow(path, w1.Offset, 2)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if w2.Output != "世" || w2.Offset != len(content) || w2.Truncated {
		t.Fatalf("unexpected page 2: %+v", w2)
	}
}
