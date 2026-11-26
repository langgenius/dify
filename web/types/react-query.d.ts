import '@tanstack/react-query'

/** Read by the query client's cache-level error toasts; see `app/query-error-toast.ts`. */
type ErrorToastMeta = {
  /** `false` when the owner presents the failure itself, for example inline or in its own toast. */
  errorToast?: false
  /** Replaces the server's message in the error toast. */
  errorMessage?: string
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: ErrorToastMeta & {
      /**
       * `false`: the console invalidation fallback never refreshes this query, for a read whose
       * owner keeps it current and remounts on new data, such as a streaming chat's history.
       */
      invalidateAfterWrites?: false
    }
    mutationMeta: ErrorToastMeta & {
      /** The tag-creation policy leaves the agent tag catalog to the caller's own refresh. */
      deferAgentTagCatalogRefresh?: boolean
      /**
       * `false`: the console invalidation fallback skips this mutation, because it changes no
       * cached data or its owner reconciles the cache itself. See `service/console/README.md`.
       */
      invalidate?: false
      /**
       * Console paths (`'agent'`, `'workspaces.current.features'`) the fallback refreshes besides
       * the mutation's own domain, for known cross-domain effects.
       */
      alsoInvalidate?: readonly string[]
    }
  }
}
