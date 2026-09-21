# Image resource budgets

The `Image resource budgets` workflow checks added or modified frontend images in pull requests and merge groups. Budget violations or unreadable resources fail the job. It uses a repository-owned Python script with no third-party dependencies or write permissions.

## Scope and limits

The checker scans tracked images under `web/public/`, `web/app/`, and `packages/iconify-collections/assets/`. Documentation images elsewhere, remote images, generated icon JSON, and data URLs inside application code are outside its scope. It does not determine whether an asset is used at runtime.

Budgets live in `scripts/image-resource-budgets.json`:

| Rule | Limit | Measurement |
| --- | --- | --- |
| `raster-bytes` | 500 KiB | Complete raster file, including animated images |
| `svg-gzip-bytes` | 50 KiB | Local gzip estimate of the complete SVG |
| `embedded-raster-bytes` | 16 KiB | Sum of decoded raster data URLs in SVG image elements |

SVGs are measured after gzip so repetitive vector artwork is not penalized solely for verbose markup. Embedded rasters have a separate budget because base64 can conceal oversized or repeated images, even in an otherwise small SVG. Both `href` and `xlink:href` are supported.

These are review budgets, not proof that an image can be compressed without quality loss. The checker does not infer displayed dimensions, evaluate visual quality, or measure production transfer sizes. Optimize for the actual display size and screen density, then compare the result in light and dark themes as applicable.

## Local use

Run from the repository root:

```sh
python3 scripts/check_image_resources.py --base origin/main
python3 -m unittest discover -s scripts -p 'test_check_image_resources.py'
```

The comparison uses the merge base with the supplied revision and checks committed changes through `HEAD`, including renamed destinations and excluding deletions. Uncommitted changes are not selected by this mode.

To audit all tracked images, including historical violations:

```sh
python3 scripts/check_image_resources.py --all
```

A manual workflow run also performs the full audit. Existing over-budget images do not block unrelated PRs, but changing one requires optimization or an explicit exception. Full audits may fail on existing images.

## Exceptions

For a justified requirement, add an exact file path and a reason for each exempted rule. Other rules still apply. Exemptions appear in the job summary so they remain visible during review.

```json
{
  "exceptions": {
    "web/public/example.png": {
      "raster-bytes": "Full-resolution product screenshot required for the documented 3x display size."
    }
  }
}
```

Merge this entry into the existing configuration; keep its `limits` object. Do not use directory-wide or wildcard exemptions. Invalid configuration fails the job.

The workflow produces file annotations and a job summary without posting PR comments. To make it a merge gate, a repository administrator must require the `Image resource budgets` status check in the branch rules.
