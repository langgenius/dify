// Keep the complete router as ESM re-exports so unused operations can be removed.
// oxlint-disable-next-line no-barrel-files/no-barrel-files -- Direct ESM re-exports preserve operation tree-shaking at the shared client entry.
export { api as consoleClient, query as consoleQuery } from './console.openapi'
