import type { GeneratedGraph, WorkflowGeneratorMode } from './types'
import { createApp } from '@/service/apps'
import { fetchWorkflowDraft, syncWorkflowDraft } from '@/service/workflow'
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
  /**
   * Planner-picked product-style name (e.g. "URL Summarizer"). When empty,
   * we fall back to ``deriveAppName(instruction)`` so the apps list never
   * shows an empty title.
   */
  appName?: string
  /**
   * Planner-picked emoji (e.g. "📰"). When empty, we fall back to 🤖
   * which is the historical default.
   */
  icon?: string
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
  appName,
  icon,
}: ApplyToNewAppParams): Promise<{ appId: string, appMode: AppModeEnum }> => {
  const appMode = MODE_TO_APP_MODE[mode]
  const name = (appName ?? '').trim() || deriveAppName(instruction)
  const appIcon = (icon ?? '').trim() || '🤖'
  const app = await createApp({
    name,
    mode: appMode,
    icon_type: 'emoji',
    icon: appIcon,
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
 *
 * The backend's ``sync_draft_workflow`` rejects writes whose ``hash`` doesn't
 * match the existing draft's ``unique_hash`` (WorkflowHashNotEqualError), so we
 * must read the current draft first to grab its hash. We also preserve the
 * existing ``features``, ``environment_variables`` and ``conversation_variables``
 * — only nodes / edges / viewport (the ``graph`` field) get replaced by the
 * generated graph.
 *
 * Caller is responsible for showing the overwrite confirmation dialog before
 * invoking this.
 */
export const applyToCurrentApp = async ({
  appId,
  graph,
}: ApplyToCurrentAppParams): Promise<void> => {
  const url = `apps/${appId}/workflows/draft`

  // First sync may have no existing draft (workflow apps are created with no
  // draft and Studio lazy-creates one on the first save). fetchWorkflowDraft
  // is silent — on a 404 it returns null/undefined, so we treat missing as
  // "no existing draft" and sync without a hash.
  let existing: Awaited<ReturnType<typeof fetchWorkflowDraft>> | null = null
  try {
    existing = await fetchWorkflowDraft(url)
  }
  catch {
    existing = null
  }

  await syncWorkflowDraft({
    url,
    params: {
      graph,
      features: existing?.features ?? {},
      environment_variables: existing?.environment_variables ?? [],
      conversation_variables: existing?.conversation_variables ?? [],
      // Field is accepted by the backend but not typed in the Pick<> shape of
      // ``syncWorkflowDraft``'s params — spread it in so it reaches the wire.
      ...(existing?.hash ? { hash: existing.hash } : {}),
    } as Parameters<typeof syncWorkflowDraft>[0]['params'],
  })
}
