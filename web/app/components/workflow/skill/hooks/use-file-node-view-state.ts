import { useRef } from 'react'

export type FileNodeViewState = 'resolving' | 'ready' | 'missing'

type ResolveFileNodeViewStateParams = {
  hasFileTabId: boolean
  hasCurrentFileNode: boolean
  isNodeMapLoading: boolean
  isNodeMapFetching: boolean
  isNodeMapFetched: boolean
  isNodeResolutionPending: boolean
}

type UseFileNodeViewStateParams = {
  fileTabId: string | null
  hasCurrentFileNode: boolean
  isNodeMapLoading: boolean
  isNodeMapFetching: boolean
  isNodeMapFetched: boolean
}

export const resolveFileNodeViewState = ({
  hasFileTabId,
  hasCurrentFileNode,
  isNodeMapLoading,
  isNodeMapFetching,
  isNodeMapFetched,
  isNodeResolutionPending,
}: ResolveFileNodeViewStateParams): FileNodeViewState => {
  if (!hasFileTabId || hasCurrentFileNode)
    return 'ready'

  if (isNodeResolutionPending && (!isNodeMapFetched || isNodeMapLoading || isNodeMapFetching))
    return 'resolving'

  return 'missing'
}

export function useFileNodeViewState({
  fileTabId,
  hasCurrentFileNode,
  isNodeMapLoading,
  isNodeMapFetching,
  isNodeMapFetched,
}: UseFileNodeViewStateParams): FileNodeViewState {
  const hasFileTabId = Boolean(fileTabId)
  const resolutionRef = useRef<{ tabId: string | null, pending: boolean }>({
    tabId: fileTabId,
    pending: hasFileTabId,
  })

  if (resolutionRef.current.tabId !== fileTabId) {
    resolutionRef.current = {
      tabId: fileTabId,
      pending: hasFileTabId,
    }
  }

  if (fileTabId && resolutionRef.current.pending) {
    const isQuerySettled = isNodeMapFetched && !isNodeMapLoading && !isNodeMapFetching
    if (hasCurrentFileNode || isQuerySettled)
      resolutionRef.current.pending = false
  }

  return resolveFileNodeViewState({
    hasFileTabId,
    hasCurrentFileNode,
    isNodeMapLoading,
    isNodeMapFetching,
    isNodeMapFetched,
    isNodeResolutionPending: resolutionRef.current.pending,
  })
}
