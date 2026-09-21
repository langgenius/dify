# Image optimization checks

The `Image optimization` workflow trial-compresses added or modified images in pull requests. It fails when the candidate is **more than 25% smaller** than the original, or an image cannot be inspected. There are no fixed file-size limits or gzip budgets. Explicit ignore rules require a reason.

The checker and tests are maintained in this directory. Pillow is pinned in `requirements.txt`; SVGO and its transitive dependencies are pinned in the standalone `package.json`/`package-lock.json` here; CI needs no external image service or repository write permission.

## Compression policy

| Format | Trial optimization |
| --- | --- |
| Static PNG (up to 8-bit samples) | Pillow lossless re-encoding, preserving dimensions and pixel values |
| Static JPEG | Pillow quality 90, optimized progressive encoding |
| Static WebP | Pillow quality 90, method 6 |
| SVG without whitespace-sensitive content | SVGO with an explicit plugin allowlist, plus recompression of supported embedded rasters |
| SVG with whitespace-sensitive content, 16-bit PNG, animated/multi-frame images and other raster formats | Explicitly reported as skipped |

JPEG/WebP trials are **lossy**: savings are evidence of an optimization opportunity, not proof of identical quality. Review candidates before using them. Check mode never overwrites source images. Explicit `--fix` mode applies candidates exceeding the same 25% threshold. Neither mode resizes images or fetches/inlines external SVG images. It cannot detect excessive pixel dimensions relative to CSS display size, so oversized rasters displayed in small UI elements still require visual/contextual review.

`optimize_svg.mjs` uses only SVGO's `removeComments` (preserving protected `<!--! ... -->` comments) and `sortAttrs` plugins, with compact XML serialization. It does **not** enable `preset-default`. Groups, styles, IDs, definitions, geometry, namespaces, and references are retained; CSS-bearing SVGs, SVG 2 `href`, legacy `xlink:href`, and externally referenced sprites are supported. This deliberately trades compression opportunities from structural rewrites for a smaller set of transformations. Keep the CSS/reference regression tests when changing this policy.

SVGs containing `text`, `tspan`, `textPath`, `foreignObject`, or any `xml:space="preserve"` attribute are skipped entirely, including namespace-prefixed elements and root-level attributes. SVGO can trim meaningful whitespace during parsing even without structural plugins. These files and their embedded images remain byte-for-byte unchanged in check and fix modes.

For SVGs, the percentage compares the complete original and optimized file sizes, including embedded data. It is not a production transfer estimate. Already-compressed images can pass regardless of their absolute size. An exactly 25% reduction passes; a greater reduction fails. Failed trials do not silently pass as optimized resources.

## Scope

Tracked image files anywhere in the repository are inspected, including documentation and backend assets. Selection uses image filename extensions, with no directory allowlist. Remote images, generated icon JSON, and data URLs inside application code are outside the scope. The checker does not determine whether an asset is used at runtime.

The workflow runs only on pull requests and checks out the PR head commit. Checks compare the merge base of the target branch and PR head through `HEAD`, covering the entire PR diff across all commits, selecting added/modified/renamed destinations and excluding deletions. Uncommitted changes do not add paths to this selection, but selected images are read from the working tree, so local fixes can be rechecked before committing. Use `--all` to include other tracked images. Untracked images must first be added with `git add`. Full audits remain available locally with `--all`; CI never falls back to a full audit.

## Ignore rules

`ignore.json` is an array of rules, empty by default. Each rule requires a repository-relative `pattern` and a nonempty `reason`, for example:

```json
[
  {"pattern": "docs/images/upstream-logo.png", "reason": "Keep the upstream brand asset unchanged"},
  {"pattern": "api/tests/fixtures/images/*.png", "reason": "Tests require the original encoded bytes"}
]
```

Matching is case-sensitive against the complete path using Python `fnmatchcase`: `*` matches any characters **including `/`**, `?` matches one character, and `[abc]` matches a character set. `**` has no special meaning beyond `*`. Use forward slashes; absolute paths and `.`/`..` segments are rejected. This is not gitignore syntax: there are no negation rules, comments, or directory-only patterns. The first matching rule supplies the reported reason.

Check mode, `--fix`, and `--output-dir` all honor the same rules. Ignored images are not decoded, modified, or exported; logs and the CI summary report each ignored path, pattern, reason, and the total ignored count. Invalid or missing configuration fails the command before any images are modified. Keep patterns narrow so unrelated images remain checked.

## Local use

Use Node.js 24 and uv. Install the isolated SVG optimizer dependencies once from the repository root (also after lockfile changes):

```sh
npm ci --prefix scripts/image-resources --ignore-scripts --no-audit --no-fund
```

This does not install the application's frontend dependencies. The checker calls the local Node.js helper; it does not download tools at runtime. Missing dependencies or optimizer failures fail the check. Then run:

```sh
uv run --with-requirements scripts/image-resources/requirements.txt python scripts/image-resources/check_image_resources.py --base origin/main
uv run --with-requirements scripts/image-resources/requirements.txt python -m unittest discover -s scripts/image-resources -p 'test_check_image_resources.py'
```

To audit everything and save candidates for review:

```sh
uv run --with-requirements scripts/image-resources/requirements.txt python scripts/image-resources/check_image_resources.py --all --output-dir /tmp/dify-image-candidates
```

The output directory must be outside the repository. Only candidates exceeding the savings threshold are saved, preserving repository-relative paths. Compare them in their actual display context, including dark mode and high-DPI displays, before manually applying any candidate.

To apply fixes locally using the same compression policy:

```sh
uv run --with-requirements scripts/image-resources/requirements.txt python scripts/image-resources/check_image_resources.py --base origin/main --fix
# Inspect the modified images visually, then rerun the check before committing.
uv run --with-requirements scripts/image-resources/requirements.txt python scripts/image-resources/check_image_resources.py --base origin/main
```

Use `--all --fix` to optimize all tracked images in scope. `--fix` and `--output-dir` are mutually exclusive. Fix mode overwrites only images exceeding the 25% savings threshold, reports each modified file and its savings, and leaves passing/skipped/invalid images untouched. It exits successfully when all detected opportunities are fixed; inspection or write errors still return a failure, even if other files were fixed. Changes are not staged or committed. Review them in their actual display context, especially JPEG/WebP candidates (including embedded rasters), because these are lossy. Subsequent checks read the updated files.

CI continues to run check mode only. CI emits file annotations and a summary of sizes, savings, methods, and skipped resources. Failing compression candidates are uploaded as the `image-optimization-candidates` artifact; no PR comments or source commits are created. To make failures block merging, require the `Image optimization` status check in the repository branch rules.
