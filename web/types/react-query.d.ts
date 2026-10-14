import '@tanstack/react-query'

type RequestErrorMeta = {
  /** Titles the failure toast, with the server message as its description; on a query it also toasts the first load. */
  errorMessage?: string
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: RequestErrorMeta
    mutationMeta: RequestErrorMeta
  }
}
