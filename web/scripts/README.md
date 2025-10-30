# Production Build Optimization Scripts

## optimize-standalone.js

This script removes unnecessary development dependencies from the Next.js standalone build output to reduce the production Docker image size.

### What it does

The script specifically targets and removes `jest-worker` packages that are bundled with Next.js but not needed in production. These packages are included because:

1. Next.js includes jest-worker in its compiled dependencies
1. terser-webpack-plugin (used by Next.js for minification) depends on jest-worker
1. pnpm's dependency resolution creates symlinks to jest-worker in various locations

### Usage

The script is automatically run during Docker builds via the `build:docker` npm script:

```bash
# Docker build (removes jest-worker after build)
pnpm build:docker
```

To run the optimization manually:

```bash
node scripts/optimize-standalone.js
```

### What gets removed

- `node_modules/.pnpm/next@*/node_modules/next/dist/compiled/jest-worker`
- `node_modules/.pnpm/terser-webpack-plugin@*/node_modules/jest-worker` (symlinks)
- `node_modules/.pnpm/jest-worker@*` (actual packages)

### Impact

Removing jest-worker saves approximately 36KB per instance from the production image. While this may seem small, it helps ensure production images only contain necessary runtime dependencies.
