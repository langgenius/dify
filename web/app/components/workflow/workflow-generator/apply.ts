import type { GeneratedGraph, WorkflowGeneratorMode } from './types'
import { createApp, deleteApp } from '@/service/apps'
import { fetchWorkflowDraft, syncWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'

const MODE_TO_APP_MODE: Record<WorkflowGeneratorMode, AppModeEnum> = {
  workflow: AppModeEnum.WORKFLOW,
  'advanced-chat': AppModeEnum.ADVANCED_CHAT,
}

/**
 * Thrown by ``applyToCurrentApp`` when the backend rejects the sync because
 * the draft's ``unique_hash`` doesn't match — typically another tab edited
 * the draft after we fetched it. The caller maps this to a dedicated
 * "Workspace was edited elsewhere" toast with a Reload affordance instead
 * of a generic "Apply failed".
 *
 * Backend surfaces this as HTTP 409 with ``error_code:
 * "draft_workflow_not_sync"`` (see
 * ``api/controllers/console/app/error.py::DraftWorkflowNotSync``).
 */
export class WorkflowApplyHashCollisionError extends Error {
  constructor() {
    super('Workflow draft was modified in another tab; reload required.')
    this.name = 'WorkflowApplyHashCollisionError'
  }
}

/**
 * Thrown by ``applyToNewApp`` when the freshly-created app's draft sync
 * failed AND we couldn't roll back by deleting the new app. The caller
 * routes the user to ``/apps`` so the orphan is at least discoverable and
 * surfaces a localised toast — without this an unrecoverable orphan would
 * silently sit in the app list with no graph.
 */
export class WorkflowApplyOrphanError extends Error {
  readonly orphanAppId: string

  constructor(orphanAppId: string, cause?: unknown) {
    // ES2022 Error supports ``cause`` natively via the options bag — far
    // cleaner than reassigning a typed-cast property after construction.
    super(`Failed to apply graph; new app ${orphanAppId} may be orphaned.`, { cause })
    this.name = 'WorkflowApplyOrphanError'
    this.orphanAppId = orphanAppId
  }
}

const isHashCollisionResponse = (e: unknown): boolean => {
  // The shared ``post()`` wrapper rejects with the raw ``Response`` for non-401
  // failures (see ``service/base.ts::request`` catch branch). At this layer the
  // only reliable signal is the HTTP status.
  if (!e || typeof e !== 'object') return false
  return (e as { status?: number }).status === 409
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
}: ApplyToNewAppParams): Promise<{
  appId: string
  appMode: AppModeEnum
  permissionKeys?: string[]
}> => {
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

  // Sync the generated graph into the brand-new app's draft. ``createApp``
  // already succeeded so the app exists; if the sync fails (network blip,
  // backend rejection of the graph) we MUST roll the createApp back so the
  // user isn't left with a discoverable-but-empty app sitting at the top
  // of their /apps list. ``deleteApp`` is best-effort — if that also fails
  // (it usually won't, it's a simple DELETE) we surface ``WorkflowApplyOrphanError``
  // so the caller can route to /apps where the orphan is still recoverable
  // by hand.
  try {
    await syncWorkflowDraft({
      url: `apps/${app.id}/workflows/draft`,
      params: {
        graph,
        features: {},
        environment_variables: [],
        conversation_variables: [],
      },
    })
  } catch (syncErr) {
    try {
      await deleteApp(app.id)
    } catch (deleteErr) {
      throw new WorkflowApplyOrphanError(app.id, deleteErr)
    }
    throw syncErr
  }

  return { appId: app.id, appMode, permissionKeys: app.permission_keys }
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

  // First sync may have no existing draft (workflow apps can exist before Studio
  // has created/saved a draft). ``fetchWorkflowDraft`` rejects on non-2xx (e.g.
  // 404), so we treat any fetch failure as "no existing draft" and sync without
  // a hash.
  let existing: Awaited<ReturnType<typeof fetchWorkflowDraft>> | null = null
  try {
    existing = await fetchWorkflowDraft(url)
  } catch {
    existing = null
  }

  try {
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
  } catch (e) {
    // 409 → draft was edited in another tab between our fetch and sync.
    // Translate the raw Response rejection into a typed error so the caller
    // can show a Reload affordance instead of a generic "apply failed" toast.
    if (isHashCollisionResponse(e)) throw new WorkflowApplyHashCollisionError()
    throw e
  }
}
