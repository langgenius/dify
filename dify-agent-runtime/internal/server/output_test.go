package server

import (
	"os"
	"path/filepath"
	"testing"
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
