export const WORKSPACE_ID_HEADER = 'X-Workspace-Id'

let currentWorkspaceId = ''

export const setCurrentWorkspaceId = (workspaceId?: string | null) => {
  currentWorkspaceId = workspaceId || ''
}

export const getCurrentWorkspaceId = () => currentWorkspaceId

export const applyWorkspaceIdHeader = (headers: Headers, options: { isMarketplaceAPI?: boolean } = {}) => {
  if (options.isMarketplaceAPI) {
    headers.delete(WORKSPACE_ID_HEADER)
    return headers
  }

  if (currentWorkspaceId)
    headers.set(WORKSPACE_ID_HEADER, currentWorkspaceId)

  return headers
}

export const withWorkspaceIdHeader = (headers?: HeadersInit, options: { isMarketplaceAPI?: boolean } = {}) => {
  return applyWorkspaceIdHeader(new Headers(headers), options)
}
