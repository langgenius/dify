import type {
  Action,
  ChecklistErrorPayload,
  DifyBuilderSessionController,
  SessionModel,
} from './types'
import type { DifyBuilderCanvasNode } from './utils'
import { atom } from 'jotai'
import {
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from './session/state'
import { shouldStartBuildSession } from './utils'

export type DifyBuilderRuntime = {
  appId?: string
  canEdit: boolean
  enabled: boolean
  getCanvasSnapshot: () => { nodes: DifyBuilderCanvasNode[]; edgeCount: number }
  onSyncDraft: () => Promise<unknown>
  session: DifyBuilderSessionController
  setShowPanel: (show: boolean) => void
}

const EMPTY_ACTIONS: Action[] = []

const isTerminalStatus = (status?: string) => status === 'complete' || status === 'failed'
const isActiveStatus = (status?: string) => status === 'thinking' || status === 'executing'
const canContinueConversation = (status?: string) =>
  status === 'waiting_input' || status === 'waiting_confirmation'

export const difyBuilderRuntimeAtom = atom<DifyBuilderRuntime | null>(null)
export const difyBuilderSelectedModelAtom = atom<SessionModel | null>(null)
export const difyBuilderDraftAtom = atom('')
export const difyBuilderLocalErrorAtom = atom('')
export const difyBuilderChecklistErrorsAtom = atom<ChecklistErrorPayload[]>([])
export const difyBuilderCanvasRefreshGenerationAtom = atom(0)
export const difyBuilderCanvasRefreshingAtom = atom(false)
export const difyBuilderCanvasRefreshFailedAtom = atom(false)
export const difyBuilderCanvasRefreshRetryRequestAtom = atom(0)
export const difyBuilderChecklistEvaluatedGenerationAtom = atom(-1)

export const difyBuilderScopedAtoms = [
  difyBuilderRuntimeAtom,
  difyBuilderSelectedModelAtom,
  difyBuilderDraftAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderChecklistErrorsAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshRetryRequestAtom,
  difyBuilderChecklistEvaluatedGenerationAtom,
] as const

export const difyBuilderAvailableAtom = atom((get) => get(difyBuilderRuntimeAtom)?.enabled === true)
export const difyBuilderHasSessionAtom = atom((get) => get(difyBuilderSessionViewAtom) !== null)
export const difyBuilderActiveInteractionAtom = atom((get) => {
  const view = get(difyBuilderSessionViewAtom)
  const interaction = view?.active_interaction
  return interaction?.valid_at_version === view?.version ? interaction : null
})
export const difyBuilderActionsAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.actions ?? EMPTY_ACTIONS,
)
export const difyBuilderInterruptedAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.interrupted ?? false,
)
export const difyBuilderRecoveryAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.recovery ?? null,
)
export const difyBuilderViewVersionAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.version ?? 0,
)
export const difyBuilderSessionIdAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.session_id ?? null,
)
export const difyBuilderPhaseAtom = atom((get) => get(difyBuilderSessionViewAtom)?.phase)
export const difyBuilderSessionModelAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.model ?? null,
)
export const difyBuilderRunActiveAtom = atom((get) =>
  isActiveStatus(get(difyBuilderSessionViewAtom)?.run_status),
)
export const difyBuilderInteractionBusyAtom = atom(
  (get) =>
    get(difyBuilderSessionBusyAtom) ||
    (get(difyBuilderRunActiveAtom) && !get(difyBuilderInterruptedAtom)) ||
    get(difyBuilderCanvasRefreshingAtom),
)
export const difyBuilderRetryCanvasRefreshAtom = atom(null, (get, set) => {
  if (!get(difyBuilderCanvasRefreshFailedAtom) || get(difyBuilderInteractionBusyAtom)) return false

  set(difyBuilderCanvasRefreshingAtom, true)
  set(difyBuilderCanvasRefreshRetryRequestAtom, (request) => request + 1)
  return true
})
export const difyBuilderCanComposeAtom = atom((get) => {
  if (get(difyBuilderInteractionBusyAtom)) return false
  const view = get(difyBuilderSessionViewAtom)
  if (view?.recovery || view?.app_revision?.conflicted) return false
  return !view || isTerminalStatus(view.run_status) || canContinueConversation(view.run_status)
})
export const difyBuilderCanSendDraftAtom = atom(
  (get) => get(difyBuilderCanComposeAtom) && Boolean(get(difyBuilderDraftAtom).trim()),
)
export const difyBuilderModelReadonlyAtom = atom((get) => {
  const view = get(difyBuilderSessionViewAtom)
  return (
    get(difyBuilderInteractionBusyAtom) ||
    isActiveStatus(view?.run_status) ||
    view?.run_status === 'paused' ||
    !!view?.recovery ||
    !!view?.app_revision?.conflicted
  )
})
export const difyBuilderCanvasLockedAtom = atom(
  (get) =>
    get(difyBuilderSessionBusyAtom) ||
    get(difyBuilderCanvasRefreshingAtom) ||
    !!get(difyBuilderSessionViewAtom)?.canvas_read_only,
)
export const difyBuilderRecheckReadyAtom = atom(
  (get) =>
    !get(difyBuilderCanvasRefreshingAtom) &&
    !get(difyBuilderCanvasRefreshFailedAtom) &&
    get(difyBuilderChecklistEvaluatedGenerationAtom) ===
      get(difyBuilderCanvasRefreshGenerationAtom),
)
export const difyBuilderErrorAtom = atom(
  (get) => get(difyBuilderLocalErrorAtom) || get(difyBuilderSessionLastErrorAtom),
)
export const difyBuilderCanStartFixAtom = atom((get) => {
  const runtime = get(difyBuilderRuntimeAtom)
  const view = get(difyBuilderSessionViewAtom)

  return !!(
    get(difyBuilderAvailableAtom) &&
    runtime?.canEdit &&
    !get(difyBuilderInteractionBusyAtom) &&
    (!view || isTerminalStatus(view.run_status))
  )
})

const prepareDifyBuilderSessionAtom = atom(null, async (get, set) => {
  const runtime = get(difyBuilderRuntimeAtom)
  if (!runtime?.enabled || !runtime.appId || get(difyBuilderInteractionBusyAtom)) return false

  set(difyBuilderLocalErrorAtom, '')
  try {
    await runtime.onSyncDraft()
    return true
  } catch (error) {
    set(difyBuilderLocalErrorAtom, String(error))
    return false
  }
})

export const difyBuilderStartPromptAtom = atom(null, async (get, set, text: string) => {
  const prompt = text.trim()
  const runtime = get(difyBuilderRuntimeAtom)
  const view = get(difyBuilderSessionViewAtom)
  if (
    !runtime?.enabled ||
    !runtime.appId ||
    !runtime.canEdit ||
    !prompt ||
    get(difyBuilderSessionBusyAtom)
  )
    return false

  runtime.setShowPanel(true)
  if (view && !isTerminalStatus(view.run_status)) {
    if (!canContinueConversation(view.run_status)) return false
    if (!(await set(prepareDifyBuilderSessionAtom))) return false
    return runtime.session.sendMessage(prompt)
  }
  if (!(await set(prepareDifyBuilderSessionAtom))) return false

  const { nodes, edgeCount } = runtime.getCanvasSnapshot()
  const selectedModel = get(difyBuilderSelectedModelAtom) ?? undefined
  return shouldStartBuildSession(nodes, edgeCount)
    ? runtime.session.startBuild(runtime.appId, prompt, selectedModel)
    : runtime.session.startEdit(runtime.appId, prompt, selectedModel)
})

export const difyBuilderSendDraftAtom = atom(null, async (get, set) => {
  const draft = get(difyBuilderDraftAtom)
  const prompt = draft.trim()
  if (!prompt || !get(difyBuilderCanComposeAtom)) return false

  const sent = await set(difyBuilderStartPromptAtom, prompt)
  if (sent && get(difyBuilderDraftAtom) === draft) set(difyBuilderDraftAtom, '')
  return sent
})

export const difyBuilderStartRunFixAtom = atom(null, async (get, set, failedRunId: string) => {
  const runtime = get(difyBuilderRuntimeAtom)
  if (!runtime?.appId || !failedRunId || !get(difyBuilderCanStartFixAtom)) return false

  runtime.setShowPanel(true)
  if (!(await set(prepareDifyBuilderSessionAtom))) return false
  return runtime.session.startFix(
    runtime.appId,
    failedRunId,
    get(difyBuilderSelectedModelAtom) ?? undefined,
  )
})

export const difyBuilderStartChecklistFixAtom = atom(
  null,
  async (get, set, errors: ChecklistErrorPayload[]) => {
    const runtime = get(difyBuilderRuntimeAtom)
    if (!runtime?.appId || errors.length === 0 || !get(difyBuilderCanStartFixAtom)) return false

    set(difyBuilderChecklistErrorsAtom, errors)
    set(difyBuilderChecklistEvaluatedGenerationAtom, get(difyBuilderCanvasRefreshGenerationAtom))
    runtime.setShowPanel(true)
    if (!(await set(prepareDifyBuilderSessionAtom))) return false
    return runtime.session.startChecklistFix(
      runtime.appId,
      errors,
      get(difyBuilderSelectedModelAtom) ?? undefined,
    )
  },
)

export const difyBuilderSelectModelAtom = atom(null, async (get, set, model: SessionModel) => {
  const runtime = get(difyBuilderRuntimeAtom)
  const view = get(difyBuilderSessionViewAtom)
  if (
    !runtime?.enabled ||
    !runtime.canEdit ||
    get(difyBuilderSessionBusyAtom) ||
    isActiveStatus(view?.run_status) ||
    view?.run_status === 'paused' ||
    !!view?.recovery ||
    !!view?.app_revision?.conflicted
  )
    return false

  set(difyBuilderSelectedModelAtom, model)
  if (!view || isTerminalStatus(view.run_status)) return true

  const updated = await runtime.session.updateModel(model)
  if (!updated) set(difyBuilderSelectedModelAtom, get(difyBuilderSessionViewAtom)?.model ?? null)
  return updated
})

export const difyBuilderSubmitActionAtom = atom(
  null,
  (get, set, actionId: string, payload: Record<string, unknown> = {}) => {
    const runtime = get(difyBuilderRuntimeAtom)
    if (!runtime?.enabled || !runtime.canEdit) return Promise.resolve(false)

    set(difyBuilderLocalErrorAtom, '')
    if (actionId === 'recheck') {
      if (!get(difyBuilderRecheckReadyAtom)) return Promise.resolve(false)
      const errors = get(difyBuilderChecklistErrorsAtom)
      return runtime.session.runAction(actionId, {
        passed: errors.length === 0,
        remaining: errors,
      })
    }
    return runtime.session.runAction(actionId, payload)
  },
)

export const difyBuilderLoadOlderConversationAtom = atom(null, (get) => {
  const runtime = get(difyBuilderRuntimeAtom)
  if (!runtime?.enabled) return Promise.resolve(false)
  return runtime.session.loadOlderConversation()
})

export const difyBuilderRegisterChecklistErrorsAtom = atom(
  null,
  (_get, set, { errors, generation }: { errors: ChecklistErrorPayload[]; generation: number }) => {
    set(difyBuilderChecklistErrorsAtom, errors)
    set(difyBuilderChecklistEvaluatedGenerationAtom, generation)
  },
)

export const difyBuilderResetAtom = atom(null, (get, set) => {
  get(difyBuilderRuntimeAtom)?.session.reset()
  set(difyBuilderSelectedModelAtom, null)
  set(difyBuilderDraftAtom, '')
  set(difyBuilderLocalErrorAtom, '')
  set(difyBuilderChecklistErrorsAtom, [])
  set(difyBuilderCanvasRefreshGenerationAtom, 0)
  set(difyBuilderCanvasRefreshingAtom, false)
  set(difyBuilderCanvasRefreshFailedAtom, false)
  set(difyBuilderChecklistEvaluatedGenerationAtom, -1)
})
