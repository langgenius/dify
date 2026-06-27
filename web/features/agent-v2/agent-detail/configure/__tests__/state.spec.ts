import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import {
  agentConfigureClearPreviewChatAtom,
  agentConfigureComposerRebaseRevisionAtom,
  agentConfigureConversationIdsAtom,
  agentConfigureRightPanelChatModeAtom,
  agentConfigureRightPanelModeAtom,
  agentConfigureSelectedVersionIdAtom,
  agentConfigureSelectVersionAtom,
  agentConfigureShowPreviewVersionsAtom,
  agentConfigureSoulSourceOverrideAtom,
  rebaseAgentConfigureComposerAtom,
  resetAgentConfigureConversationAtom,
  setAgentConfigureConversationIdAtom,
} from '../state'

describe('agent configure state graph', () => {
  it('selects versions through the shared source override entrypoint', () => {
    const store = createStore()

    store.set(agentConfigureSelectVersionAtom, 'snapshot-1')

    expect(store.get(agentConfigureSelectedVersionIdAtom)).toBe('snapshot-1')
    expect(store.get(agentConfigureSoulSourceOverrideAtom)).toBe('view-version')

    store.set(agentConfigureSelectVersionAtom, null)

    expect(store.get(agentConfigureSelectedVersionIdAtom)).toBeNull()
    expect(store.get(agentConfigureSoulSourceOverrideAtom)).toBeNull()
  })

  it('derives the actual chat mode from the visible right panel mode', () => {
    const store = createStore()

    expect(store.get(agentConfigureRightPanelChatModeAtom)).toBe('build')

    store.set(agentConfigureRightPanelModeAtom, 'preview')

    expect(store.get(agentConfigureRightPanelChatModeAtom)).toBe('build')
  })

  it('updates and resets conversation state through named actions', () => {
    const store = createStore()

    store.set(setAgentConfigureConversationIdAtom, {
      mode: 'build',
      conversationId: 'build-conversation-1',
    })
    store.set(setAgentConfigureConversationIdAtom, {
      mode: 'preview',
      conversationId: 'preview-conversation-1',
    })

    expect(store.get(agentConfigureConversationIdsAtom)).toEqual({
      build: 'build-conversation-1',
      preview: 'preview-conversation-1',
    })

    store.set(resetAgentConfigureConversationAtom, 'build')

    expect(store.get(agentConfigureConversationIdsAtom)).toEqual({
      build: null,
      preview: 'preview-conversation-1',
    })
    expect(store.get(agentConfigureClearPreviewChatAtom)).toBe(true)
  })

  it('tracks composer rebase as a workflow command', () => {
    const store = createStore()

    store.set(rebaseAgentConfigureComposerAtom)
    store.set(rebaseAgentConfigureComposerAtom)

    expect(store.get(agentConfigureComposerRebaseRevisionAtom)).toBe(2)
  })

  it('keeps independent panel state as separate primitives', () => {
    const store = createStore()

    store.set(agentConfigureShowPreviewVersionsAtom, true)

    expect(store.get(agentConfigureShowPreviewVersionsAtom)).toBe(true)
  })
})
