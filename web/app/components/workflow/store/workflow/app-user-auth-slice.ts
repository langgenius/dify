import type { StateCreator } from 'zustand'
import type {
  AppUserAuthDraft,
  AppUserAuthErrors,
  AuthorizationTab,
} from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import type { ReuseFromNodeReference } from '@/app/components/plugins/plugin-auth/reuse-from-node/model'
import {
  createAppUserAuthDraft,
  validateAppUserAuth,
} from '@/app/components/plugins/plugin-auth/app-user-auth/draft'

type NodeAuthorizationDraft = {
  provider: string
  providerId: string
  authorizationTab: AuthorizationTab
  draft?: AppUserAuthDraft
  errors?: AppUserAuthErrors
  reuseFromNode?: { source: ReuseFromNodeReference }
}

export type AppUserAuthSliceShape = {
  nodeAuthDrafts: Record<string, NodeAuthorizationDraft>
  setNodeAuthorizationTab: (
    nodeId: string,
    provider: string,
    providerId: string,
    tab: AuthorizationTab,
    options?: { clearReuseFromNode?: boolean },
  ) => void
  setNodeAppUserAuthDraft: (
    nodeId: string,
    provider: string,
    providerId: string,
    draft: AppUserAuthDraft,
  ) => void
  setNodeReuseFromNode: (
    nodeId: string,
    provider: string,
    providerId: string,
    source: ReuseFromNodeReference,
  ) => void
}

const getNodeAuthorizationDraft = (
  drafts: AppUserAuthSliceShape['nodeAuthDrafts'],
  nodeId: string,
  provider: string,
  providerId: string,
): NodeAuthorizationDraft => {
  const existing = drafts[nodeId]
  return existing?.provider === provider && existing.providerId === providerId
    ? existing
    : { provider, providerId, authorizationTab: 'workspace-auth' }
}

export const createAppUserAuthSlice: StateCreator<AppUserAuthSliceShape> = (set) => ({
  // UI-only drafts must stay outside graph node data and collaboration payloads.
  nodeAuthDrafts: {},
  setNodeAuthorizationTab: (nodeId, provider, providerId, authorizationTab, options) =>
    set((state) => {
      const current = getNodeAuthorizationDraft(state.nodeAuthDrafts, nodeId, provider, providerId)
      return {
        nodeAuthDrafts: {
          ...state.nodeAuthDrafts,
          [nodeId]: {
            ...current,
            ...(options?.clearReuseFromNode ? { reuseFromNode: undefined } : {}),
            authorizationTab,
            errors:
              authorizationTab === 'app-user-auth'
                ? validateAppUserAuth(
                    current.draft ?? createAppUserAuthDraft({ canOAuth: false, canApiKey: false }),
                  )
                : undefined,
          },
        },
      }
    }),
  setNodeAppUserAuthDraft: (nodeId, provider, providerId, draft) =>
    set((state) => {
      const current = getNodeAuthorizationDraft(state.nodeAuthDrafts, nodeId, provider, providerId)
      return {
        nodeAuthDrafts: {
          ...state.nodeAuthDrafts,
          [nodeId]: {
            ...current,
            draft,
            errors:
              current.authorizationTab === 'app-user-auth' ? validateAppUserAuth(draft) : undefined,
          },
        },
      }
    }),
  setNodeReuseFromNode: (nodeId, provider, providerId, source) =>
    set((state) => {
      const current = getNodeAuthorizationDraft(state.nodeAuthDrafts, nodeId, provider, providerId)
      return {
        nodeAuthDrafts: {
          ...state.nodeAuthDrafts,
          [nodeId]: { ...current, reuseFromNode: { source } },
        },
      }
    }),
})
