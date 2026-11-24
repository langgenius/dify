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

	// Decode forward in a single O(N) pass: valid runes are preserved,
	// genuinely invalid bytes become U+FFFD, and the raw offset always
	// advances by the exact number of input bytes consumed.
	output, consumed := sanitizeUTF8Window(data, budget, offset+len(buf) < size)

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
	// The tail reaches the end of the file, so a truncated rune at the
	// end is genuinely incomplete and is replaced, not deferred.
	output, consumed := sanitizeUTF8Window(payload, len(payload), false)

	return &OutputWindow{
		Output:    output,
		Offset:    paddedStart + relativeStart + consumed,
		Truncated: false,
	}, nil
}

// sanitizeUTF8Window decodes data forward in a single O(N) pass, replacing
// genuinely invalid UTF-8 bytes with U+FFFD while preserving valid
// multi-byte rune boundaries. It returns the sanitized output and the
// number of raw input bytes consumed, so callers can advance the raw file
// offset by exactly that amount.
//
// A valid rune split across the budget boundary is deferred to the next
// page; a truncated valid rune at the end of the buffer is likewise
// deferred when more file bytes follow (hasMore), and replaced when it is
// the end of the file. At least one rune (or one invalid byte) is always
// consumed when data is non-empty, so the offset strictly advances.
func sanitizeUTF8Window(data []byte, budget int, hasMore bool) (string, int) {
	var out strings.Builder
	out.Grow(len(data))
	consumed := 0
	for consumed < len(data) {
		if consumed >= budget {
			break
		}
		r, size := utf8.DecodeRune(data[consumed:])
		if r == utf8.RuneError && size == 1 && !utf8.FullRune(data[consumed:]) {
			// Truncated valid rune at the end of the buffer.
			if hasMore {
				break
			}
			// End of file: replace each remaining byte.
			out.WriteRune(utf8.RuneError)
			consumed++
			continue
		}
		if consumed+size > budget {
			break
		}
		out.WriteRune(r)
		consumed += size
	}
	if consumed == 0 && len(data) > 0 {
		// Guarantee forward progress: consume the first rune (or one
		// invalid byte) even if it exceeds the budget.
		r, size := utf8.DecodeRune(data)
		if r != utf8.RuneError || size != 1 || utf8.FullRune(data) {
			out.WriteRune(r)
			consumed = size
		} else if !hasMore {
			out.WriteRune(utf8.RuneError)
			consumed = 1
		}
	}
	return out.String(), consumed
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
