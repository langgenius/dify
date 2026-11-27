import '@tanstack/react-query'

/** Read by the query client's cache-level error toasts; see `app/query-error-toast.ts`. */
type ErrorToastMeta = {
  /**
   * `false` when the owner presents every failure itself, including a query's failed refetch over
   * cached data, or when a read is deliberately silent.
   */
  errorToast?: false
  /** The toast's text for an error code the request error catalog does not translate. */
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
       * cached data or its owner reconciles the cache itself. A function decides per call from
       * the variables, for a write endpoint also used read-only (a preview run). See
       * `service/console/README.md`.
       */
      invalidate?: false | ((variables: unknown) => boolean)
      /** A read sent as POST: it never holds back another write's refresh while pending. */
      readOnly?: true
      /**
       * Console paths (`'agent'`, `'workspaces.current.features'`) the fallback refreshes besides
       * the mutation's own domain, for known cross-domain effects.
       */
      alsoInvalidate?: readonly string[]
    }
  }
}
