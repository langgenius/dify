import type { AgentSoulConfigFormState, AgentTool } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { syncCliToolReferenceLabels } from '../reference-labels'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerToolsAtom = atom(
  get => get(agentComposerDraftAtom).tools,
  (get, set, toolsUpdate: DraftFieldUpdate<AgentTool[]>) => {
    const draft = get(agentComposerDraftAtom)
    const tools = resolveDraftFieldUpdate(draft.tools, toolsUpdate)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: syncCliToolReferenceLabels({
        prompt: draft.prompt,
        currentTools: draft.tools,
        nextTools: tools,
      }),
      tools,
    })
  },
)

export const agentComposerToolSettingsAtom = atom(
  get => get(agentComposerDraftAtom).toolSettings,
  (get, set, toolSettingsUpdate: DraftFieldUpdate<Record<string, Record<string, unknown>>>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      toolSettings: resolveDraftFieldUpdate(draft.toolSettings, toolSettingsUpdate),
    })
  },
)

const omitToolSettings = (
  toolSettings: AgentSoulConfigFormState['toolSettings'],
  actionIds: string[],
) => {
  const nextToolSettings = { ...toolSettings }

  actionIds.forEach((actionId) => {
    delete nextToolSettings[actionId]
  })

  return nextToolSettings
}

export function useRemoveProviderTool() {
  const setDraft = useSetAtom(agentComposerDraftAtom)

  return useCallback((toolId: string) => {
    setDraft((draft) => {
      const toolToRemove = draft.tools.find(tool => tool.kind === 'provider' && tool.id === toolId)
      const actionIds = toolToRemove?.kind === 'provider'
        ? toolToRemove.actions.map(action => action.id)
        : []

      return {
        ...draft,
        tools: draft.tools.filter(tool => tool.id !== toolId),
        toolSettings: omitToolSettings(draft.toolSettings, actionIds),
      }
    })
  }, [setDraft])
}

export function useRemoveProviderToolAction() {
  const setDraft = useSetAtom(agentComposerDraftAtom)

  return useCallback((toolId: string, actionId: string) => {
    setDraft(draft => ({
      ...draft,
      tools: draft.tools.flatMap((tool) => {
        if (tool.kind !== 'provider' || tool.id !== toolId)
          return [tool]

        const nextActions = tool.actions.filter(action => action.id !== actionId)
        return nextActions.length > 0
          ? [{ ...tool, actions: nextActions }]
          : []
      }),
      toolSettings: omitToolSettings(draft.toolSettings, [actionId]),
    }))
  }, [setDraft])
}

export function useSetProviderToolCredential() {
  const setTools = useSetAtom(agentComposerToolsAtom)

  return useCallback((toolId: string, credentialId?: string) => {
    setTools(tools => tools.map((tool) => {
      if (tool.kind !== 'provider' || tool.id !== toolId)
        return tool

      return {
        ...tool,
        credentialId,
        credentialType: 'api-key',
        credentialVariant: 'authorized',
      }
    }))
  }, [setTools])
}
