// Package sanitize implements a streaming PTY output sanitizer.
//
// It strips ANSI escape sequences (CSI, OSC), normalizes carriage-return
// progress updates into the final visible line, and performs incremental
// UTF-8 decoding—mirroring the Python shellctl_runtime/sanitize.py.
package sanitize

import (
	"bufio"
	"io"
	"os"
	"unicode/utf8"
)

// escapeState tracks the ANSI escape sequence parser state.
type escapeState int

const (
	stateNormal escapeState = iota
	stateEsc
	stateCSI
	stateOSC
	stateOSCEsc
)

// PtySanitizer incrementally converts PTY bytes into stable, readable UTF-8.
type PtySanitizer struct {
	lineBuffer []byte
	pendingCR  bool
	state      escapeState
}

// New returns a fresh PtySanitizer.
func New() *PtySanitizer {
	return &PtySanitizer{}
}

// Feed consumes one chunk of decoded text and returns newly stable output.
func (s *PtySanitizer) Feed(text []byte) []byte {
	var out []byte
	for len(text) > 0 {
		r, size := utf8.DecodeRune(text)
		if r == utf8.RuneError && size <= 1 {
			// Replace invalid byte with U+FFFD
			text = text[1:]
			r = utf8.RuneError
		} else {
			text = text[size:]
		}
		out = s.consumeRune(r, out)
	}
	return out
}

// Flush returns any remaining buffered content at end-of-stream.
func (s *PtySanitizer) Flush() []byte {
	s.state = stateNormal
	s.pendingCR = false
	result := s.lineBuffer
	s.lineBuffer = nil
	return result
}

func (s *PtySanitizer) consumeRune(r rune, out []byte) []byte {
	switch s.state {
	case stateNormal:
		if r == '\x1b' {
			s.state = stateEsc
			return out
		}
		return s.consumeVisible(r, out)

	case stateEsc:
		switch r {
		case '[':
			s.state = stateCSI
		case ']':
			s.state = stateOSC
		default:
			s.state = stateNormal
			if r != '\x1b' && isPrintable(r) {
				return s.consumeVisible(r, out)
			}
		}
		return out

	case stateCSI:
		// CSI sequence ends at a byte in the range 0x40–0x7E
		if r >= '@' && r <= '~' {
			s.state = stateNormal
		}
		return out

	case stateOSC:
		switch r {
		case '\x07':
			s.state = stateNormal
		case '\x1b':
			s.state = stateOSCEsc
		}
		return out

	case stateOSCEsc:
		if r == '\\' {
			s.state = stateNormal
		} else {
			s.state = stateOSC
		}
		return out
	}
	return out
}

func (s *PtySanitizer) consumeVisible(r rune, out []byte) []byte {
	if s.pendingCR {
		if r == '\n' {
			out = append(out, s.lineBuffer...)
			out = append(out, '\n')
			s.lineBuffer = nil
			s.pendingCR = false
			return out
		}
		// CR without LF: overwrite line buffer (progress update)
		s.lineBuffer = nil
		s.pendingCR = false
	}

	if r == '\r' {
		s.pendingCR = true
		return out
	}
	if r == '\n' {
		out = append(out, s.lineBuffer...)
		out = append(out, '\n')
		s.lineBuffer = nil
		return out
	}

	// Append rune to line buffer
	var buf [utf8.UTFMax]byte
	n := utf8.EncodeRune(buf[:], r)
	s.lineBuffer = append(s.lineBuffer, buf[:n]...)
	return out
}

func isPrintable(r rune) bool {
	// Match Python's str.isprintable: exclude C0/C1 control chars
	return r >= 0x20 && r != 0x7f
}

// Run executes the streaming sanitizer as a stdin→stdout filter.
// If readyFile is non-empty, it is touched before reading begins.
func Run(readyFile string, stdin io.Reader, stdout io.Writer) error {
	if readyFile != "" {
		f, err := os.Create(readyFile)
		if err != nil {
			return err
		}
		_ = f.Close()
	}

	sanitizer := New()
	reader := bufio.NewReaderSize(stdin, 65536)
	writer := bufio.NewWriter(stdout)
	defer func() { _ = writer.Flush() }()

	buf := make([]byte, 65536)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			out := sanitizer.Feed(buf[:n])
			if len(out) > 0 {
				if _, werr := writer.Write(out); werr != nil {
					return werr
				}
				_ = writer.Flush()
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
	}

	tail := sanitizer.Flush()
	if len(tail) > 0 {
		if _, err := writer.Write(tail); err != nil {
			return err
		}
	}
	return writer.Flush()
}
