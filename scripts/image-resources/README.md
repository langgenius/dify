# Image optimization checks

The `Image optimization` workflow trial-compresses added or modified frontend images in pull requests and merge groups. It fails when the candidate is **more than 25% smaller** than the original, or an image cannot be inspected. There are no fixed file-size limits, gzip budgets, or per-file budget exceptions.

The checker and tests are maintained in this directory. Pillow and Scour are pinned in `requirements.txt`; no external image service or repository write permission is needed.

## Compression policy

| Format | Trial optimization |
| --- | --- |
| Static PNG | Pillow lossless re-encoding, preserving dimensions and pixel values |
| Static JPEG | Pillow quality 90, optimized progressive encoding |
| Static WebP | Pillow quality 90, method 6 |
| SVG | Scour markup optimization and recompression of supported embedded rasters |
| Animated/multi-frame images and other raster formats | Explicitly reported as skipped |

JPEG/WebP trials are **lossy**: savings are evidence of an optimization opportunity, not proof of identical quality. Review candidates before using them. The checker never overwrites source images or resizes them, and does not fetch or inline external SVG images. It cannot detect excessive pixel dimensions relative to CSS display size, so the original 160×160-to-7×7 mismatch still requires visual/contextual review.

For SVGs, the percentage compares the complete original and optimized file sizes, including embedded data. It is not a production transfer estimate. Already-compressed images can pass regardless of their absolute size. An exactly 25% reduction passes; a greater reduction fails. Failed trials do not silently pass as optimized resources.

## Scope

Tracked images under `web/public/`, `web/app/`, and `packages/iconify-collections/assets/` are inspected. Documentation images elsewhere, remote images, generated icon JSON, and data URLs inside application code are outside the scope. The checker does not determine whether an asset is used at runtime.

PR and merge-group checks compare the merge base with the supplied revision through `HEAD`, selecting added/modified/renamed destinations and excluding deletions. Uncommitted changes are not selected by this mode. Manual workflow runs audit all tracked images in scope, including historical optimization opportunities.

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

CI emits file annotations and a summary of sizes, savings, methods, and skipped resources. Failing compression candidates are uploaded as the `image-optimization-candidates` artifact; no PR comments or source commits are created. To make failures block merging, require the `Image optimization` status check in the repository branch rules.
