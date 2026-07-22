# API Image HTTP Health Smoke

## Summary

- Added `pnpm docker:api:http-smoke` to start the production API image and verify `/health`.
- Added the HTTP smoke to the GitHub Actions Docker image job after the WASM import smoke.
- Fixed the production esbuild bundle by adding a `createRequire` banner, because the HTTP smoke exposed a runtime failure from bundled CommonJS dependencies requiring Node built-ins.

## TDD

- Added failing workflow/script assertions first for the missing HTTP image smoke.
- Ran the new smoke and used the runtime failure to add a focused production build-script regression test before fixing `build:prod`.

## Performance And Safety

- The smoke uses a dynamically mapped localhost port and a bounded health response reader.
- The container cleanup path force-removes the smoke container in `finally`.
- No external database, object storage, parser, or provider service is required; the image starts with bounded local fallbacks.

## Verification

- Passed: `node --test scripts/github-actions-workflow.test.mjs scripts/api-image-http-smoke.test.mjs`
- Passed: `pnpm --filter @knowledge/api-app test -- src/server-options.test.ts`
- Passed: `pnpm docker:api:build`
- Passed: `pnpm docker:api:http-smoke`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `cargo test --workspace`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 5 after review checkpoint `563f24c`.
