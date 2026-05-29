import type { GeneratedGraph, WorkflowGeneratorMode } from './types'
import { createApp } from '@/service/apps'
import { syncWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'

const MODE_TO_APP_MODE: Record<WorkflowGeneratorMode, AppModeEnum> = {
  'workflow': AppModeEnum.WORKFLOW,
  'advanced-chat': AppModeEnum.ADVANCED_CHAT,
}

// Derive a sane App name from the user's instruction: trim, cap at 40 chars,
// strip trailing punctuation.
const deriveAppName = (instruction: string): string => {
  const trimmed = instruction.trim().slice(0, 40)
  return trimmed.replace(/[.,!?;:。，！？；：]+$/, '').trim() || 'Generated Workflow'
}

type ApplyToNewAppParams = {
  mode: WorkflowGeneratorMode
  graph: GeneratedGraph
  instruction: string
}

/**
 * Apply path A — create a brand-new Workflow / Chatflow app and write the
 * generated graph into its draft. Returns the created app id so the caller
 * can route to ``/app/{id}/workflow``.
 */
export const applyToNewApp = async ({
  mode,
  graph,
  instruction,
}: ApplyToNewAppParams): Promise<{ appId: string, appMode: AppModeEnum }> => {
  const appMode = MODE_TO_APP_MODE[mode]
  const app = await createApp({
    name: deriveAppName(instruction),
    mode: appMode,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
    description: instruction.trim().slice(0, 200),
  })

  await syncWorkflowDraft({
    url: `apps/${app.id}/workflows/draft`,
    params: {
      graph,
      features: {},
      environment_variables: [],
      conversation_variables: [],
    },
  })

  return { appId: app.id, appMode }
}

type ApplyToCurrentAppParams = {
  appId: string
  graph: GeneratedGraph
}

/**
 * Apply path B — overwrite the current Workflow Studio's draft graph.
 * Caller is responsible for showing the overwrite confirmation dialog before
 * calling this.
 */
export const applyToCurrentApp = async ({
  appId,
  graph,
}: ApplyToCurrentAppParams): Promise<void> => {
  await syncWorkflowDraft({
    url: `apps/${appId}/workflows/draft`,
    params: {
      graph,
      features: {},
      environment_variables: [],
      conversation_variables: [],
    },
  })
}
