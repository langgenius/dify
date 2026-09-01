import type { DifyBuilderCanvasNode } from './utils'
import type {
  Action,
  ConversationItem,
  SessionModel,
} from '@dify/contracts/dify-builder'
import type { ChecklistErrorPayload } from '@/app/components/dify-builder/types'
import type { DifyBuilderSessionController } from '@/app/components/dify-builder/use-dify-builder-session'
import { atom } from 'jotai'
import {
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from '@/app/components/dify-builder/state'
import { shouldStartBuildSession } from './utils'

export type DifyBuilderRuntime = {
  appId?: string
  canEdit: boolean
  getCanvasSnapshot: () => { nodes: DifyBuilderCanvasNode[]; edgeCount: number }
  onSyncDraft: () => Promise<unknown>
  session: DifyBuilderSessionController
  setShowPanel: (show: boolean) => void
}

const EMPTY_ACTIONS: Action[] = []
const EMPTY_CONVERSATION: ConversationItem[] = []

const isTerminalStatus = (status?: string) => status === 'complete' || status === 'failed'

export const difyBuilderRuntimeAtom = atom<DifyBuilderRuntime | null>(null)
export const difyBuilderSelectedModelAtom = atom<SessionModel | null>(null)
export const difyBuilderLocalErrorAtom = atom('')
export const difyBuilderChecklistErrorsAtom = atom<ChecklistErrorPayload[]>([])

export const difyBuilderScopedAtoms = [
  difyBuilderRuntimeAtom,
  difyBuilderSelectedModelAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderChecklistErrorsAtom,
] as const

export const difyBuilderAvailableAtom = atom((get) => get(difyBuilderRuntimeAtom) !== null)
export const difyBuilderHasSessionAtom = atom((get) => get(difyBuilderSessionViewAtom) !== null)
export const difyBuilderConversationAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.conversation ?? EMPTY_CONVERSATION,
)
export const difyBuilderActionsAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.actions ?? EMPTY_ACTIONS,
)
export const difyBuilderInterruptedAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.interrupted ?? false,
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
export const difyBuilderRunExecutingAtom = atom(
  (get) => get(difyBuilderSessionViewAtom)?.run_status === 'executing',
)
export const difyBuilderInteractionBusyAtom = atom(
  (get) => get(difyBuilderSessionBusyAtom) || get(difyBuilderRunExecutingAtom),
)
export const difyBuilderCanComposeAtom = atom((get) => !get(difyBuilderInteractionBusyAtom))
export const difyBuilderModelReadonlyAtom = atom((get) => get(difyBuilderInteractionBusyAtom))
export const difyBuilderCanvasLockedAtom = atom(
  (get) => get(difyBuilderSessionBusyAtom) || !!get(difyBuilderSessionViewAtom)?.canvas_read_only,
)
export const difyBuilderErrorAtom = atom(
  (get) => get(difyBuilderLocalErrorAtom) || get(difyBuilderSessionLastErrorAtom),
)
export const difyBuilderCanStartFixAtom = atom((get) => {
  const runtime = get(difyBuilderRuntimeAtom)
  const view = get(difyBuilderSessionViewAtom)

  return !!(
    runtime?.canEdit &&
    !get(difyBuilderSessionBusyAtom) &&
    (!view || isTerminalStatus(view.run_status))
  )
})

const prepareDifyBuilderSessionAtom = atom(null, async (get, set) => {
  const runtime = get(difyBuilderRuntimeAtom)
  if (!runtime?.appId || get(difyBuilderSessionBusyAtom)) return false

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
  if (!runtime?.appId || !runtime.canEdit || !prompt || get(difyBuilderSessionBusyAtom))
    return false

  runtime.setShowPanel(true)
  if (view && !isTerminalStatus(view.run_status)) return runtime.session.sendMessage(prompt)
  if (!(await set(prepareDifyBuilderSessionAtom))) return false

  const { nodes, edgeCount } = runtime.getCanvasSnapshot()
  const selectedModel = get(difyBuilderSelectedModelAtom) ?? undefined
  return shouldStartBuildSession(nodes, edgeCount)
    ? runtime.session.startBuild(runtime.appId, prompt, selectedModel)
    : runtime.session.startEdit(runtime.appId, prompt, selectedModel)
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
  if (!runtime?.canEdit || get(difyBuilderSessionBusyAtom) || view?.run_status === 'executing')
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
    if (!runtime?.canEdit) return Promise.resolve(false)

    set(difyBuilderLocalErrorAtom, '')
    if (actionId === 'recheck') {
      const errors = get(difyBuilderChecklistErrorsAtom)
      return runtime.session.runAction(actionId, {
        passed: errors.length === 0,
        remaining: errors,
      })
    }
    return runtime.session.runAction(actionId, payload)
  },
)

export const difyBuilderRegisterChecklistErrorsAtom = atom(
  null,
  (_get, set, errors: ChecklistErrorPayload[]) => {
    set(difyBuilderChecklistErrorsAtom, errors)
  },
)

export const difyBuilderResetAtom = atom(null, (get, set) => {
  get(difyBuilderRuntimeAtom)?.session.reset()
  set(difyBuilderSelectedModelAtom, null)
  set(difyBuilderLocalErrorAtom, '')
})
