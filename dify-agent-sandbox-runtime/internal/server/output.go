package server

import (
	"fmt"
	"os"
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
	defer f.Close()

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

	// Find the longest valid UTF-8 prefix within budget
	consumed := validUTF8PrefixLen(data, budget)
	if consumed == 0 && len(data) > 0 {
		// At least consume one complete rune
		consumed = firstCompleteRuneLen(data)
	}

	outputBytes := data[:consumed]
	newOffset := offset + startShift + consumed
	truncated := newOffset < size

	return &OutputWindow{
		Output:    string(outputBytes),
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
	defer f.Close()

	readLen := size - paddedStart
	buf := make([]byte, readLen)
	_, err = f.ReadAt(buf, int64(paddedStart))
	if err != nil {
		return nil, err
	}

	relativeStart := advanceToUTF8Boundary(buf, start-paddedStart)
	payload := buf[relativeStart:]
	consumed := validUTF8PrefixLen(payload, len(payload))
	outputBytes := payload[:consumed]

	return &OutputWindow{
		Output:    string(outputBytes),
		Offset:    paddedStart + relativeStart + consumed,
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

// validUTF8PrefixLen returns the length of the longest valid UTF-8 prefix up to maxLen.
func validUTF8PrefixLen(data []byte, maxLen int) int {
	if maxLen > len(data) {
		maxLen = len(data)
	}
	end := maxLen
	for end > 0 {
		if utf8.Valid(data[:end]) {
			return end
		}
		end--
	}
	return 0
}

// firstCompleteRuneLen returns the byte length of the first complete rune in data.
func firstCompleteRuneLen(data []byte) int {
	for end := 1; end <= len(data) && end <= 4; end++ {
		if utf8.Valid(data[:end]) {
			return end
		}
	}
	return 0
}
