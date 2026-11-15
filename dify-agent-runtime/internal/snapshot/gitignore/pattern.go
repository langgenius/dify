package gitignore

import (
	"path/filepath"
	"strings"
)

// MatchResult defines outcomes of a match, no match, exclusion or inclusion.
type MatchResult int

const (
	// NoMatch defines the no match outcome of a match check
	NoMatch MatchResult = iota
	// Exclude defines an exclusion of a file as a result of a match check
	Exclude
	// Include defines an explicit inclusion of a file as a result of a match check
	Include
)

const (
	inclusionPrefix = "!"
	zeroToManyDirs  = "**"
	patternDirSep   = "/"
)

// Pattern defines a single gitignore pattern.
type Pattern interface {
	// Match matches the given path to the pattern.
	Match(path []string, isDir bool) MatchResult
}

type pattern struct {
	domain    []string
	pattern   []string
	inclusion bool
	dirOnly   bool
	isGlob    bool
}

// ParsePattern parses a gitignore pattern string into the Pattern structure.
func ParsePattern(p string, domain []string) Pattern {
	// storing domain, copy it to ensure it isn't changed externally
	domain = append([]string(nil), domain...)
	res := pattern{domain: domain}

	if strings.HasPrefix(p, inclusionPrefix) {
		res.inclusion = true
		p = p[1:]
	}

	if !strings.HasSuffix(p, "\\ ") {
		p = strings.TrimRight(p, " ")
	}

	if strings.HasSuffix(p, patternDirSep) {
		res.dirOnly = true
		p = p[:len(p)-1]
	}

	if strings.Contains(p, patternDirSep) {
		res.isGlob = true
	}

	res.pattern = strings.Split(p, patternDirSep)
	return &res
}

func (p *pattern) Match(path []string, isDir bool) MatchResult {
	if len(path) <= len(p.domain) {
		return NoMatch
	}
	for i, e := range p.domain {
		if path[i] != e {
			return NoMatch
		}
	}

	path = path[len(p.domain):]
	if p.isGlob && !p.globMatch(path, isDir) {
		return NoMatch
	} else if !p.isGlob && !p.simpleNameMatch(path, isDir) {
		return NoMatch
	}

	if p.inclusion {
		return Include
	} else {
		return Exclude
	}
}

func (p *pattern) simpleNameMatch(path []string, isDir bool) bool {
	for i, name := range path {
		if match, err := filepath.Match(p.pattern[0], name); err != nil {
			return false
		} else if !match {
			continue
		}
		if p.dirOnly && !isDir && i == len(path)-1 {
			return false
		}
		return true
	}
	return false
}

func (p *pattern) globMatch(path []string, isDir bool) bool {
	matched := false
	canTraverse := false
	for i, pattern := range p.pattern {
		if pattern == "" {
			canTraverse = false
			continue
		}
		if pattern == zeroToManyDirs {
			if i == len(p.pattern)-1 {
				break
			}
			canTraverse = true
			continue
		}
		if strings.Contains(pattern, zeroToManyDirs) {
			return false
		}
		if len(path) == 0 {
			return false
		}
		if canTraverse {
			canTraverse = false
			for len(path) > 0 {
				e := path[0]
				path = path[1:]
				if match, err := filepath.Match(pattern, e); err != nil {
					return false
				} else if match {
					matched = true
					break
				} else if len(path) == 0 {
					// if nothing left then fail
					matched = false
				}
			}
		} else {
			if match, err := filepath.Match(pattern, path[0]); err != nil || !match {
				return false
			}
			matched = true
			path = path[1:]
		}
	}
	if matched && p.dirOnly && !isDir && len(path) == 0 {
		matched = false
	}
	return matched
}
