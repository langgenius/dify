// ProvidedContext augmentation intentionally omitted.
//
// Both 'vitest' and '@voidzero-dev/vite-plus-test' module augmentation paths
// cause errors under the tsgo type-checker used by the Main CI pipeline:
//   - Augmenting 'vitest' → TS2300 duplicate identifier (re-exported in @0.1.22)
//   - Augmenting '@voidzero-dev/vite-plus-test' → TS2664 module not found
//     (tsgo runs in cli/ and cannot resolve pnpm virtual-store symlinks)
//
// The three call sites (global-setup, devices, logout) use @ts-ignore to
// suppress the TS2345 / TS2339 errors locally.  Runtime behaviour is correct
// because project.provide() / inject() work via string keys at runtime
// regardless of the compile-time type constraint.
export {}
