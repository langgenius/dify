# Release preparation

The package is currently an experimental beta under `@dify/openapi-inference`. The manifest defaults to the npm `beta` tag, not `latest`. Preparing or testing a tarball does not publish it.

## Verify a release candidate

From the Dify repository root, install workspace dependencies with the pinned pnpm version, then run:

```sh
pnpm --filter @dify/openapi-inference build
pnpm --filter @dify/openapi-inference type-check
pnpm --filter @dify/openapi-inference test
pnpm --filter @dify/openapi-inference test:package
```

`test:package` packs the package and installs it with npm in a temporary directory outside the repository. It checks the file allowlist, resolved dependencies, declarations, license, TS 7.1 mapper, typed document context, Node hooks and tree-shaking with official Vite. It needs network access to install consumer dependencies. Its subprocesses use bounded memory and concurrency.

The dedicated CI job also runs Next.js Turbopack/Webpack fixtures against the full console specification and verifies the production metadata bundle. Keep full application builds in CI on resource-constrained workstations. See the [repository guide] for Dify-specific checks.

## Pack

Update `version` and `CHANGELOG.md` together. Build from a clean checkout with passing CI. To retain the exact artifact verified by the independent consumer check:

```sh
OPENAPI_PACKAGE_TARBALL=/tmp/dify-openapi-inference.tgz \
  pnpm --filter @dify/openapi-inference test:package
```

`prepack` cleans and rebuilds `dist`. Always use pnpm to create the tarball: it [resolves workspace `catalog:` versions] into registry dependencies. Inspect and test the resulting artifact; do not publish the workspace source directory using npm directly.

The package includes compiled ESM and declaration files, its manifest, README, changelog, license, the [oRPC comparison] and this guide. It excludes source tests, fixtures, OpenAPI snapshots and application code. Consumers do not build the SDK during installation.

## Publish an approved artifact

Actual publication is a separate maintainer action requiring npm publish access to the chosen scope. Confirm the package name, version, license and registry before publishing the tested tarball:

```sh
npm publish /tmp/dify-openapi-inference.tgz --access public --tag beta
```

Use the same artifact that passed the consumer check. This repository does not automatically publish the package on merge or on a Dify release. Do not configure a workflow that uploads without a separate release decision.

After publication, verify registry metadata and install that exact version in an empty consumer project. Increment the prerelease version for subsequent changes; an existing version must not be overwritten. Promotion to a stable version and `latest` needs an explicit compatibility decision.

## Compatibility and license

- The supported compiler protocol is pinned to TypeScript `7.1.0-beta`; validate new compiler versions before claiming support.
- Official Vite 8.3.5 is tested independently of the monorepo's Vite Plus alias. Vite is an optional peer because Node and Next.js consumers do not need it.
- Only `api` and `query` are document exports. Adapter implementation subpaths are not application APIs.
- The license is copied verbatim from Dify's repository license. Changing the package name or moving it to another repository does not change those terms.

[oRPC comparison]: orpc-comparison.md
[repository guide]: https://github.com/langgenius/dify/blob/main/packages/openapi-inference/docs/repository.md
[resolves workspace `catalog:` versions]: https://pnpm.io/catalogs
