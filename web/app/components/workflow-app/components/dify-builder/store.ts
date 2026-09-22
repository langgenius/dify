import type {
  Action,
  ChecklistErrorPayload,
  DifyBuilderActiveInteraction,
  DifyBuilderSessionController,
  SessionModel,
} from './types'
import type { DifyBuilderCanvasNode } from './utils'
import { atom } from 'jotai'
import { atomWithMutation, queryClientAtom } from 'jotai-tanstack-query'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderConversationAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderRetryableMessageAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionErrorCodeAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from './session/state'
import { shouldStartBuildSession } from './utils'

export type DifyBuilderRuntime = {
  appId?: string
  canEdit: boolean
  enabled: boolean
  getCanvasSnapshot: () => { nodes: DifyBuilderCanvasNode[]; edgeCount: number }
  session: DifyBuilderSessionController
  setShowPanel: (show: boolean) => void
}

const EMPTY_ACTIONS: Action[] = []

const isTerminalStatus = (status?: string) => status === 'complete' || status === 'failed'
const isActiveStatus = (status?: string) => status === 'processing'
const canContinueConversation = (status?: string) =>
  status === 'waiting_input' || status === 'waiting_confirmation'

export const difyBuilderRuntimeAtom = atom<DifyBuilderRuntime | null>(null)
const difyBuilderFixMutationKeyAtom = atom((get) => [
  'dify-builder',
  'start-fix',
  get(difyBuilderRuntimeAtom)?.appId,
])
const difyBuilderStartFixMutationAtom = atomWithMutation((get) => ({
  mutationKey: get(difyBuilderFixMutationKeyAtom),
  mutationFn: (startFix: () => Promise<boolean>) => startFix(),
  retry: false,
}))
export const difyBuilderSelectedModelAtom = atom<SessionModel | null>(null)
export const difyBuilderDraftAtom = atom('')
export const difyBuilderDeriveAppNameAtom = atom(false)
export const difyBuilderLocalErrorAtom = atom('')
export const difyBuilderRunRestoreErrorAtom = atom('')
export const difyBuilderChecklistErrorsAtom = atom<ChecklistErrorPayload[]>([])
export const difyBuilderCanvasRefreshGenerationAtom = atom(0)
export const difyBuilderCanvasRefreshingAtom = atom(false)
export const difyBuilderCanvasRefreshFailedAtom = atom(false)
export const difyBuilderCanvasRefreshRetryRequestAtom = atom(0)
export const difyBuilderCanvasPendingRefreshAtom = atom<{
  sessionId: string
  focusNodeId?: string
} | null>(null)
export const difyBuilderCanvasAppliedViewAtom = atom<{ sessionId: string; version: number } | null>(
  null,
)
export const difyBuilderChecklistEvaluatedGenerationAtom = atom(-1)

export const difyBuilderScopedAtoms = [
  difyBuilderRuntimeAtom,
  difyBuilderSelectedModelAtom,
  difyBuilderDraftAtom,
  difyBuilderDeriveAppNameAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderRunRestoreErrorAtom,
  difyBuilderChecklistErrorsAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshRetryRequestAtom,
  difyBuilderCanvasPendingRefreshAtom,
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderChecklistEvaluatedGenerationAtom,
] as const

export const difyBuilderAvailableAtom = atom((get) => get(difyBuilderRuntimeAtom)?.enabled === true)
export const difyBuilderHasSessionAtom = atom(
  (get) =>
    get(difyBuilderSessionViewAtom) !== null ||
    get(difyBuilderActiveCommandAtom) !== null ||
    get(difyBuilderLocalUserMessageAtom) !== null,
)
export const difyBuilderInteractionRefAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.active_interaction ?? null,
)
export const difyBuilderInteractionAtom = atom<DifyBuilderActiveInteraction | null>((get) => {
  const interaction = get(difyBuilderInteractionRefAtom)
  if (!interaction) return null
  const card = get(difyBuilderConversationAtom).find((item) => item.seq === interaction.card_seq)
  return card ? { ...interaction, card } : null
})
export const difyBuilderActiveInteractionAtom = atom((get) => {
  const view = get(difyBuilderSessionViewAtom)
  const interaction = get(difyBuilderInteractionAtom)
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
  (get) =>
    get(difyBuilderSessionViewAtom)?.session_id ??
    get(difyBuilderActiveCommandAtom)?.session_id ??
    null,
)
export const difyBuilderPhaseAtom = atom(
  (get) => get(difyBuilderActiveCommandAtom)?.phase ?? get(difyBuilderSessionViewAtom)?.phase,
)
export const difyBuilderRunStatusAtom = atom(
  (get) =>
    get(difyBuilderActiveCommandAtom)?.run_status ?? get(difyBuilderSessionViewAtom)?.run_status,
)
export const DIFY_BUILDER_CANVAS_REFRESH_PHASES = new Set([
  'modify',
  'test',
  'review',
  'publish',
  'complete',
])
export const difyBuilderCanvasReadyAtom = atom((get) => {
  if (get(difyBuilderCanvasRefreshingAtom) || get(difyBuilderCanvasRefreshFailedAtom)) return false
  const view = get(difyBuilderSessionViewAtom)
  if (view && get(difyBuilderCanvasPendingRefreshAtom)?.sessionId === view.session_id) return false
  if (!view?.phase || !DIFY_BUILDER_CANVAS_REFRESH_PHASES.has(view.phase)) return true
  const applied = get(difyBuilderCanvasAppliedViewAtom)
  return applied?.sessionId === view.session_id && applied.version === view.version
})
export const difyBuilderSessionModelAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.model ?? null,
)
export const difyBuilderRunActiveAtom = atom((get) => isActiveStatus(get(difyBuilderRunStatusAtom)))
export const difyBuilderInteractionBusyAtom = atom(
  (get) =>
    get(difyBuilderStartFixMutationAtom).isPending ||
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
  if (get(difyBuilderInteractionBusyAtom) || !get(difyBuilderCanvasReadyAtom)) return false
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
    !get(difyBuilderCanvasReadyAtom) ||
    isActiveStatus(view?.run_status) ||
    view?.run_status === 'paused' ||
    !!view?.recovery ||
    !!view?.app_revision?.conflicted
  )
})
export const difyBuilderCanvasLockedAtom = atom(
  (get) =>
    get(difyBuilderSessionBusyAtom) ||
    !get(difyBuilderCanvasReadyAtom) ||
    !!get(difyBuilderSessionViewAtom)?.canvas_read_only,
)
export const difyBuilderRecheckReadyAtom = atom(
  (get) =>
    get(difyBuilderCanvasReadyAtom) &&
    get(difyBuilderChecklistEvaluatedGenerationAtom) ===
      get(difyBuilderCanvasRefreshGenerationAtom),
)
export const difyBuilderErrorAtom = atom(
  (get) =>
    get(difyBuilderLocalErrorAtom) ||
    (get(difyBuilderSessionErrorCodeAtom) === 'model_unavailable'
      ? ''
      : get(difyBuilderSessionLastErrorAtom)) ||
    get(difyBuilderRunRestoreErrorAtom),
)
export const difyBuilderCanStartFixAtom = atom((get) => {
  const runtime = get(difyBuilderRuntimeAtom)
  const view = get(difyBuilderSessionViewAtom)

  return !!(
    get(difyBuilderAvailableAtom) &&
    runtime?.canEdit &&
    !get(difyBuilderInteractionBusyAtom) &&
    get(difyBuilderCanvasReadyAtom) &&
    !isActiveStatus(view?.run_status)
  )
})

const prepareDifyBuilderSessionAtom = atom(null, (get, set) => {
  const runtime = get(difyBuilderRuntimeAtom)
  if (
    !runtime?.enabled ||
    !runtime.appId ||
    get(difyBuilderInteractionBusyAtom) ||
    !get(difyBuilderCanvasReadyAtom)
  )
    return false

  set(difyBuilderLocalErrorAtom, '')
  return true
})

const startDifyBuilderPromptAtom = atom(
  null,
  async (get, set, { model, text }: { model: SessionModel; text: string }) => {
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
      if (!set(prepareDifyBuilderSessionAtom)) return false
      return runtime.session.sendMessage(prompt)
    }
    if (!set(prepareDifyBuilderSessionAtom)) return false

    const { nodes, edgeCount } = runtime.getCanvasSnapshot()
    const startsBuild = shouldStartBuildSession(nodes, edgeCount)
    const deriveAppName = startsBuild && get(difyBuilderDeriveAppNameAtom)
    const localId = globalThis.crypto.randomUUID()
    set(difyBuilderLocalUserMessageAtom, {
      afterSequence: -1,
      localId,
      sessionId: null,
      text: prompt,
    })
    const started = await (startsBuild
      ? deriveAppName
        ? runtime.session.startBuild(runtime.appId, prompt, model, true)
        : runtime.session.startBuild(runtime.appId, prompt, model)
      : runtime.session.startEdit(runtime.appId, prompt, model))
    if (deriveAppName && get(difyBuilderSessionViewAtom)) set(difyBuilderDeriveAppNameAtom, false)
    if (!started) {
      set(difyBuilderLocalUserMessageAtom, (current) =>
        current?.localId === localId ? null : current,
      )
    }
    return started
  },
)

export const difyBuilderStartPromptAtom = atom(
  null,
  (_get, set, input: { text: string; model: SessionModel }) =>
    set(startDifyBuilderPromptAtom, input),
)

export const difyBuilderSendDraftAtom = atom(null, async (get, set, model: SessionModel | null) => {
  const draft = get(difyBuilderDraftAtom)
  const prompt = draft.trim()
  if (!model || !prompt || !get(difyBuilderCanComposeAtom)) return false

  const view = get(difyBuilderSessionViewAtom)
  const isNewSession = !view || isTerminalStatus(view.run_status)
  set(difyBuilderDraftAtom, '')
  const started = await set(startDifyBuilderPromptAtom, { model, text: prompt })
  if (!started && isNewSession && !get(difyBuilderDraftAtom)) set(difyBuilderDraftAtom, draft)
  return started
})

const startDifyBuilderFixAtom = atom(
  null,
  async (get, set, target: { failedRunId: string } | { errors: ChecklistErrorPayload[] }) => {
    const runtime = get(difyBuilderRuntimeAtom)
    if (!runtime?.appId || !get(difyBuilderCanStartFixAtom)) return false
    // The cache updates synchronously, before the mutation observer notifies the UI.
    if (get(queryClientAtom).isMutating({ mutationKey: get(difyBuilderFixMutationKeyAtom) }))
      return false

    if ('errors' in target) {
      set(difyBuilderChecklistErrorsAtom, target.errors)
      set(difyBuilderChecklistEvaluatedGenerationAtom, get(difyBuilderCanvasRefreshGenerationAtom))
    }
    runtime.setShowPanel(true)
    const appId = runtime.appId
    const mutation = get(difyBuilderStartFixMutationAtom)
    // Check preparation guards before this mutation marks Builder interactions busy.
    const prepared = set(prepareDifyBuilderSessionAtom)
    return mutation.mutateAsync(async () => {
      if (!prepared) return false

      const draft = get(difyBuilderDraftAtom)
      set(difyBuilderDraftAtom, '')
      const model = get(difyBuilderSelectedModelAtom) ?? undefined
      const started = await ('failedRunId' in target
        ? runtime.session.startFix(appId, target.failedRunId, model)
        : runtime.session.startChecklistFix(appId, target.errors, model))
      if (!started && !get(difyBuilderDraftAtom)) set(difyBuilderDraftAtom, draft)
      return started
    })
  },
)

export const difyBuilderStartRunFixAtom = atom(null, (_get, set, failedRunId: string) =>
  failedRunId ? set(startDifyBuilderFixAtom, { failedRunId }) : Promise.resolve(false),
)

export const difyBuilderStartChecklistFixAtom = atom(
  null,
  (_get, set, errors: ChecklistErrorPayload[]) =>
    errors.length > 0 ? set(startDifyBuilderFixAtom, { errors }) : Promise.resolve(false),
)

export const difyBuilderSelectModelAtom = atom(null, async (get, set, model: SessionModel) => {
  const runtime = get(difyBuilderRuntimeAtom)
  const view = get(difyBuilderSessionViewAtom)
  if (
    !runtime?.enabled ||
    !runtime.canEdit ||
    get(difyBuilderSessionBusyAtom) ||
    !get(difyBuilderCanvasReadyAtom) ||
    isActiveStatus(view?.run_status) ||
    view?.run_status === 'paused' ||
    !!view?.recovery ||
    !!view?.app_revision?.conflicted
  )
    return false

  set(difyBuilderSelectedModelAtom, model)
  if (get(difyBuilderSessionErrorCodeAtom) === 'model_unavailable') {
    set(difyBuilderSessionErrorCodeAtom, null)
    set(difyBuilderSessionLastErrorAtom, '')
  }
  if (!view || isTerminalStatus(view.run_status)) return true

  const updated = await runtime.session.updateModel(model)
  if (!updated) set(difyBuilderSelectedModelAtom, get(difyBuilderSessionViewAtom)?.model ?? null)
  return updated
})

export const difyBuilderSubmitActionAtom = atom(
  null,
  (get, set, actionId: string, payload: Record<string, unknown> = {}) => {
    const runtime = get(difyBuilderRuntimeAtom)
    if (
      !runtime?.enabled ||
      !runtime.canEdit ||
      get(difyBuilderInteractionBusyAtom) ||
      !get(difyBuilderCanvasReadyAtom)
    )
      return Promise.resolve(false)

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
  set(difyBuilderDeriveAppNameAtom, false)
  set(difyBuilderDraftAtom, '')
  set(difyBuilderLocalUserMessageAtom, null)
  set(difyBuilderRetryableMessageAtom, null)
  set(difyBuilderLocalErrorAtom, '')
  set(difyBuilderChecklistErrorsAtom, [])
  set(difyBuilderCanvasRefreshGenerationAtom, 0)
  set(difyBuilderCanvasRefreshingAtom, false)
  set(difyBuilderCanvasRefreshFailedAtom, false)
  set(difyBuilderCanvasAppliedViewAtom, null)
  set(difyBuilderChecklistEvaluatedGenerationAtom, -1)
})
