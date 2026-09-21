# Image optimization checks

The `Image optimization` workflow trial-compresses added or modified frontend images in pull requests and merge groups. It fails when the candidate is **more than 25% smaller** than the original, or an image cannot be inspected. There are no fixed file-size limits, gzip budgets, or per-file budget exceptions.

The checker and tests are maintained in this directory. Pillow and Scour are pinned in `requirements.txt`; CI needs no external image service or repository write permission.

## Compression policy

| Format | Trial optimization |
| --- | --- |
| Static PNG (up to 8-bit samples) | Pillow lossless re-encoding, preserving dimensions and pixel values |
| Static JPEG | Pillow quality 90, optimized progressive encoding |
| Static WebP | Pillow quality 90, method 6 |
| SVG | Scour markup optimization and recompression of supported embedded rasters |
| 16-bit PNG, animated/multi-frame images and other raster formats | Explicitly reported as skipped |

JPEG/WebP trials are **lossy**: savings are evidence of an optimization opportunity, not proof of identical quality. Review candidates before using them. Check mode never overwrites source images. Explicit `--fix` mode applies candidates exceeding the same 25% threshold. Neither mode resizes images or fetches/inlines external SVG images. It cannot detect excessive pixel dimensions relative to CSS display size, so oversized rasters displayed in small UI elements still require visual/contextual review.

For SVGs, the percentage compares the complete original and optimized file sizes, including embedded data. It is not a production transfer estimate. Already-compressed images can pass regardless of their absolute size. An exactly 25% reduction passes; a greater reduction fails. Failed trials do not silently pass as optimized resources.

## Scope

Tracked images under `web/public/`, `web/app/`, and `packages/iconify-collections/assets/` are inspected. Documentation images elsewhere, remote images, generated icon JSON, and data URLs inside application code are outside the scope. The checker does not determine whether an asset is used at runtime.

PR and merge-group checks compare the merge base with the supplied revision through `HEAD`, selecting added/modified/renamed destinations and excluding deletions. Uncommitted changes do not add paths to this selection, but selected images are read from the working tree, so local fixes can be rechecked before committing. Use `--all` to include other tracked images. Untracked images must first be added with `git add`. Manual workflow runs audit all tracked images in scope, including historical optimization opportunities.

## Local use

Run from the repository root with uv:

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
