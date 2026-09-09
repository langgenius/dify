export type UrlOptions = {
  history: 'push' | 'replace'
  shallow: boolean
  scroll: boolean
}

export type UrlChange = {
  url: URL
  // Traversal always invalidates pending work, even when the URL is identical.
  traversal?: boolean
}

export type QueryAdapter = {
  read: () => URL
  subscribe: (listener: (change: UrlChange) => void) => () => void
  // Commits the address synchronously; server data may still be loading.
  write: (url: URL, options: UrlOptions) => void
  minimumInterval?: number
}
