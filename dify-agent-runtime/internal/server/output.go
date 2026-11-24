package server

import (
	"fmt"
	"os"
	"strings"
	"unicode/utf8"
)

// OutputWindow represents a UTF-8-safe slice of output.log.
type OutputWindow struct {
	Output    string `json:"output"`
	Offset    int    `json:"offset"`
	Truncated bool   `json:"truncated"`
}

// ReadOutputWindow reads a forward UTF-8-safe slice from an output file.
func ReadOutputWindow(path string, offset, limit int) (*OutputWindow, error) {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		if offset == 0 {
			return &OutputWindow{Output: "", Offset: 0, Truncated: false}, nil
		}
		return nil, NewServerError(400, "invalid_offset", "offset exceeds current file size 0")
	}
	if err != nil {
		return nil, err
	}

	size := int(info.Size())
	if offset > size {
		return nil, NewServerError(400, "invalid_offset",
			fmt.Sprintf("offset %d exceeds current file size %d", offset, size))
	}
	if offset == size {
		return &OutputWindow{Output: "", Offset: offset, Truncated: false}, nil
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	// Read up to limit+4 bytes to handle UTF-8 boundary
	readSize := limit + 4
	if offset+readSize > size {
		readSize = size - offset
	}

	buf := make([]byte, readSize)
	_, err = f.ReadAt(buf, int64(offset))
	if err != nil {
		return nil, err
	}

	// Advance past any UTF-8 continuation bytes at the start
	startShift := advanceToUTF8Boundary(buf, 0)
	data := buf[startShift:]
	budget := limit - startShift
	if budget < 0 {
		budget = 0
	}

	hasMoreBytes := offset+readSize < size
	output, consumed := decodeUTF8Window(data, budget, startShift > 0, hasMoreBytes)
	newOffset := offset + startShift + consumed
	truncated := newOffset < size

	return &OutputWindow{
		Output:    output,
		Offset:    newOffset,
		Truncated: truncated,
	}, nil
}

// TailOutputWindow reads a UTF-8-safe tail snapshot from an output file.
func TailOutputWindow(path string, limit int) (*OutputWindow, error) {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return &OutputWindow{Output: "", Offset: 0, Truncated: false}, nil
	}
	if err != nil {
		return nil, err
	}

	size := int(info.Size())
	if size == 0 {
		return &OutputWindow{Output: "", Offset: 0, Truncated: false}, nil
	}

	start := size - limit
	if start < 0 {
		start = 0
	}
	paddedStart := start - 4
	if paddedStart < 0 {
		paddedStart = 0
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	readLen := size - paddedStart
	buf := make([]byte, readLen)
	_, err = f.ReadAt(buf, int64(paddedStart))
	if err != nil {
		return nil, err
	}

	relativeStart := advanceToUTF8Boundary(buf, start-paddedStart)
	payload := buf[relativeStart:]
	output := decodeUTF8All(payload)

	return &OutputWindow{
		Output:    output,
		Offset:    paddedStart + relativeStart + len(payload),
		Truncated: false,
	}, nil
}

// advanceToUTF8Boundary skips continuation bytes (10xxxxxx) at position start.
func advanceToUTF8Boundary(data []byte, start int) int {
	for start < len(data) && isUTF8Continuation(data[start]) {
		start++
	}
	return start
}

// isUTF8Continuation returns true if byte is a UTF-8 continuation byte.
func isUTF8Continuation(b byte) bool {
	return (b & 0xC0) == 0x80
}

// decodeUTF8Window decodes a valid UTF-8 prefix of data whose encoded UTF-8
// length stays within maxOutputBytes, replacing genuinely invalid UTF-8 bytes
// with U+FFFD while preserving complete multi-byte runes across page boundaries.
// When data is non-empty and shiftedStart is false, at least one rune or invalid
// byte is consumed so callers always make forward offset progress.
func decodeUTF8Window(data []byte, maxOutputBytes int, shiftedStart, hasMoreBytes bool) (string, int) {
	if len(data) == 0 {
		return "", 0
	}
	if len(data) <= maxOutputBytes && utf8.Valid(data) {
		return string(data), len(data)
	}
	if maxOutputBytes > 0 && maxOutputBytes <= len(data) && utf8.Valid(data[:maxOutputBytes]) {
		return string(data[:maxOutputBytes]), maxOutputBytes
	}

	var b strings.Builder
	if maxOutputBytes > 0 {
		b.Grow(min(len(data), maxOutputBytes))
	}
	pos := 0
	for pos < len(data) {
		// If startShift skipped past limit, the remaining buffer slice can hold
		// fewer than utf8.UTFMax bytes even though more bytes follow in the file.
		// Stop before an incomplete rune so the next read decodes it intact.
		if hasMoreBytes && shiftedStart && !utf8.FullRune(data[pos:]) {
			break
		}
		r, width := utf8.DecodeRune(data[pos:])
		invalid := r == utf8.RuneError && width == 1
		encodedWidth := width
		if invalid {
			encodedWidth = utf8.RuneLen(utf8.RuneError)
		}
		if b.Len() > 0 && b.Len()+encodedWidth > maxOutputBytes {
			break
		}
		if invalid {
			b.WriteRune(utf8.RuneError)
		} else {
			b.Write(data[pos : pos+width])
		}
		pos += width
		if b.Len() >= maxOutputBytes {
			break
		}
	}
	return b.String(), pos
}

// decodeUTF8All decodes all bytes in data into a valid UTF-8 string, replacing
// each invalid UTF-8 byte with U+FFFD.
func decodeUTF8All(data []byte) string {
	if utf8.Valid(data) {
		return string(data)
	}
	var b strings.Builder
	b.Grow(len(data))
	for len(data) > 0 {
		r, width := utf8.DecodeRune(data)
		if r == utf8.RuneError && width == 1 {
			b.WriteRune(utf8.RuneError)
		} else {
			b.Write(data[:width])
		}
		data = data[width:]
	}
	return b.String()
}
