import { atom } from 'jotai'

export type AgentConfigureRightPanelMode = 'build' | 'preview'
export type AgentConfigureConversationIds = Record<AgentConfigureRightPanelMode, string | null>
export type AgentConfigureSoulSource = 'draft' | 'build-draft' | 'view-version'

export const agentConfigureSelectedVersionIdAtom = atom<string | null>(null)
export const agentConfigureComposerRebaseRevisionAtom = atom(0)
export const agentConfigureSoulSourceOverrideAtom = atom<AgentConfigureSoulSource | null>(null)

export const agentConfigureShowChatFeaturesAtom = atom(false)
export const agentConfigureShowPreviewVersionsAtom = atom(false)
export const agentConfigureRightPanelModeAtom = atom<AgentConfigureRightPanelMode>('build')
export const agentConfigureConversationIdsAtom = atom<AgentConfigureConversationIds>({
  build: null,
  preview: null,
})

export const agentConfigureRightPanelChatModeAtom = atom((get): AgentConfigureRightPanelMode => {
  const mode = get(agentConfigureRightPanelModeAtom)

  return mode === 'preview' ? 'build' : mode
})

export const agentConfigureSelectVersionAtom = atom(null, (_get, set, versionId: string | null) => {
  set(agentConfigureSoulSourceOverrideAtom, versionId ? 'view-version' : null)
  set(agentConfigureSelectedVersionIdAtom, versionId)
})

export const rebaseAgentConfigureComposerAtom = atom(null, (get, set) => {
  set(agentConfigureComposerRebaseRevisionAtom, get(agentConfigureComposerRebaseRevisionAtom) + 1)
})

export const setAgentConfigureConversationIdAtom = atom(
  null,
  (
    get,
    set,
    {
      mode,
      conversationId,
    }: {
      mode: AgentConfigureRightPanelMode
      conversationId: string | null
    },
  ) => {
    set(agentConfigureConversationIdsAtom, {
      ...get(agentConfigureConversationIdsAtom),
      [mode]: conversationId,
    })
  },
)

export const resetAgentConfigureConversationAtom = atom(
  null,
  (get, set, mode: AgentConfigureRightPanelMode) => {
    set(agentConfigureConversationIdsAtom, {
      ...get(agentConfigureConversationIdsAtom),
      [mode]: null,
    })
  },
)

export const agentConfigureScopedAtoms = [
  agentConfigureSelectedVersionIdAtom,
  agentConfigureComposerRebaseRevisionAtom,
  agentConfigureSoulSourceOverrideAtom,
  agentConfigureShowChatFeaturesAtom,
  agentConfigureShowPreviewVersionsAtom,
  agentConfigureRightPanelModeAtom,
] as const
