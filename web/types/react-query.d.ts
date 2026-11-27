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
    queryMeta: ErrorToastMeta
    mutationMeta: ErrorToastMeta & {
      /** The tag-creation policy leaves the agent tag catalog to the caller's own refresh. */
      deferAgentTagCatalogRefresh?: boolean
    }
  }
}
