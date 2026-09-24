// Package gitignore matches paths against gitignore-syntax patterns.
//
// VENDORED CODE — pattern.go and matcher.go are verbatim copies from go-git:
//
//	github.com/go-git/go-git/v5@v5.19.2  plumbing/format/gitignore
//	pattern.go  sha256 6c8442cc541e54bc05db87c228f959249b357ffbf2487e457615fc06cb8a73ee
//	matcher.go  sha256 e104fc611ae78c88a9202fce457ef6ced879982c1d6eb179fd828996e06e69f3
//
// Copyright 2018 Sourced Technologies, S.L., licensed under Apache-2.0; see
// the LICENSE file in this directory. Neither file has been modified. This
// doc.go is the only addition.
//
// Only the two matching files are vendored. Upstream's dir.go — which reads
// .gitignore files off a billy filesystem — is deliberately left out: it is
// the sole reason the upstream package depends on go-billy and go-git's config
// parser, and the runtime never reads patterns from disk. They arrive in the
// body of POST /v1/snapshot/save.
//
// To update: re-copy both files from the same upstream path at the new
// version, confirm they still import only path/filepath and strings, and
// refresh the hashes above.
package gitignore
