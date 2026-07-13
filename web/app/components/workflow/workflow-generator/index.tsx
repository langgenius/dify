'use client'
import type { SelectorParam, TFunction } from 'i18next'
import type { GeneratedGraph } from './types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  GenerateWorkflowBody,
  GenerateWorkflowResponse as StreamResult,
  WorkflowGenPlan,
} from '@/service/debug'
import type { CompletionParams, ModelModeType } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { RiErrorWarningLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import VersionSelector from '@/app/components/app/configuration/config/automatic/version-selector'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { generateWorkflow, generateWorkflowStream } from '@/service/debug'
import { fetchWorkflowDraft } from '@/service/workflow'
import { getRedirectionPath } from '@/utils/app-redirection'
import {
  applyToCurrentApp,
  applyToNewApp,
  WorkflowApplyHashCollisionError,
  WorkflowApplyOrphanError,
} from './apply'
import ExamplePrompts from './example-prompts'
import GenerationPlan from './generation-plan'
import { diffGraphs } from './graph-diff'
import {
  EMPTY_WORKFLOW_GENERATOR_MODEL,
  useWorkflowGeneratorLastInstruction,
  useWorkflowGeneratorModel,
} from './storage'
import { useWorkflowGeneratorStore } from './store'
import useGenGraph from './use-gen-graph'

// Hard ceiling before we abort a hung request. Generous on purpose: the
// backend runs two sequential LLM calls and may retry a transient provider
// error (bounded backoff) or an unparseable response (one extra call), so a
// slow-but-succeeding generation can legitimately pass the one-minute mark.
// Aborting work that would have landed is the worse failure mode.
const FE_TIMEOUT_MS = 90_000
// Mirrors the backend's instruction/ideal-output cap on /workflow-generate —
// keeping the limit client-side turns an opaque 400 into a visible input stop.
const MAX_INSTRUCTION_LENGTH = 10_000

// A single structured generation error. Mirrors the backend ``errors[]`` entry
// (stable ``code`` + human ``detail`` + optional ``node_id``) so the error panel
// can localise the message and point at the offending node.
type GenError = { code: string; detail: string; node_id?: string }

type WorkflowGeneratorErrorCode =
  | 'DANGLING_EDGE'
  | 'DUPLICATE_NODE_ID'
  | 'EMPTY_INSTRUCTION'
  | 'EMPTY_PLAN'
  | 'GRAPH_CYCLE'
  | 'INSTRUCTION_TOO_LONG'
  | 'INVALID_CONTAINER'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'MISSING_START'
  | 'MISSING_TERMINAL'
  | 'MODEL_ERROR'
  | 'UNKNOWN_NODE_REFERENCE'
  | 'UNKNOWN_TOOL'
  | 'UNRESOLVED_REFERENCE'

const workflowGeneratorErrorSelectors: Record<
  WorkflowGeneratorErrorCode,
  SelectorParam<'workflow'>
> = {
  DANGLING_EDGE: ($) => $['workflowGenerator.errors.DANGLING_EDGE'],
  DUPLICATE_NODE_ID: ($) => $['workflowGenerator.errors.DUPLICATE_NODE_ID'],
  EMPTY_INSTRUCTION: ($) => $['workflowGenerator.errors.EMPTY_INSTRUCTION'],
  EMPTY_PLAN: ($) => $['workflowGenerator.errors.EMPTY_PLAN'],
  GRAPH_CYCLE: ($) => $['workflowGenerator.errors.GRAPH_CYCLE'],
  INSTRUCTION_TOO_LONG: ($) => $['workflowGenerator.errors.INSTRUCTION_TOO_LONG'],
  INVALID_CONTAINER: ($) => $['workflowGenerator.errors.INVALID_CONTAINER'],
  INVALID_JSON: ($) => $['workflowGenerator.errors.INVALID_JSON'],
  INVALID_SCHEMA: ($) => $['workflowGenerator.errors.INVALID_SCHEMA'],
  MISSING_START: ($) => $['workflowGenerator.errors.MISSING_START'],
  MISSING_TERMINAL: ($) => $['workflowGenerator.errors.MISSING_TERMINAL'],
  MODEL_ERROR: ($) => $['workflowGenerator.errors.MODEL_ERROR'],
  UNKNOWN_NODE_REFERENCE: ($) => $['workflowGenerator.errors.UNKNOWN_NODE_REFERENCE'],
  UNKNOWN_TOOL: ($) => $['workflowGenerator.errors.UNKNOWN_TOOL'],
  UNRESOLVED_REFERENCE: ($) => $['workflowGenerator.errors.UNRESOLVED_REFERENCE'],
}

function isWorkflowGeneratorErrorCode(code: string): code is WorkflowGeneratorErrorCode {
  return Object.hasOwn(workflowGeneratorErrorSelectors, code)
}

function getWorkflowGeneratorErrorMessage(error: GenError, t: TFunction<'workflow'>) {
  if (isWorkflowGeneratorErrorCode(error.code))
    return t(workflowGeneratorErrorSelectors[error.code])

  return error.detail || t(($) => $['workflowGenerator.generateFailed'])
}

const renderPlaceholder = (label: string) => (
  <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3 px-8">
    <span className="i-custom-vender-other-generator size-8 text-text-quaternary" />
    <div className="text-center text-[13px] leading-5 font-normal text-text-tertiary">{label}</div>
  </div>
)

// AbortController throws a DOMException in modern browsers and a plain
// Error in older / non-DOM environments — accept both so we don't toast
// for an abort the user intentionally triggered.
const isAbortError = (e: unknown): boolean =>
  (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError'

type RecoveryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  onConfirm: () => void
}

// Shared shell for "we hit a snag — here's a Reload / Confirm button"
// dialogs. The overwrite-confirm and hash-collision dialogs differ only in
// copy and confirm handler; this collapses 30 lines of duplicate JSX to
// one props bag and keeps the visual styling in lockstep across both.
const RecoveryDialog = ({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
}: RecoveryDialogProps) => (
  <AlertDialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
    <AlertDialogContent>
      <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
        <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
          {description}
        </AlertDialogDescription>
      </div>
      <AlertDialogActions>
        <AlertDialogCancelButton>{cancelLabel}</AlertDialogCancelButton>
        <AlertDialogConfirmButton onClick={onConfirm}>{confirmLabel}</AlertDialogConfirmButton>
      </AlertDialogActions>
    </AlertDialogContent>
  </AlertDialog>
)

const WorkflowGeneratorModal: React.FC = () => {
  const { t } = useTranslation('workflow')
  const router = useRouter()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled

  const isOpen = useWorkflowGeneratorStore((s) => s.isOpen)
  const mode = useWorkflowGeneratorStore((s) => s.mode)
  const intent = useWorkflowGeneratorStore((s) => s.intent)
  const currentAppId = useWorkflowGeneratorStore((s) => s.currentAppId)
  const currentAppMode = useWorkflowGeneratorStore((s) => s.currentAppMode)
  const initialInstruction = useWorkflowGeneratorStore((s) => s.initialInstruction)
  const autoMode = useWorkflowGeneratorStore((s) => s.autoMode)
  const closeGenerator = useWorkflowGeneratorStore((s) => s.closeGenerator)

  const isRefine = intent === 'refine' && !!currentAppId

  const [model, setModel] = useWorkflowGeneratorModel()

  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(
    ModelTypeEnum.textGeneration,
  )

  // Hydrate model from defaultModel once it loads (async). We deliberately set state
  // from an effect here because defaultModel only resolves after the workspace's model
  // catalogue fetch completes.
  useEffect(() => {
    if (defaultModel && !model.name) {
      setModel((prev) => ({
        ...(prev ?? EMPTY_WORKFLOW_GENERATOR_MODEL),
        name: defaultModel.model,
        provider: defaultModel.provider.provider,
      }))
    }
  }, [defaultModel, model.name, setModel])

  const handleModelChange = useCallback(
    (newValue: { modelId: string; provider: string; mode?: string; features?: string[] }) => {
      setModel((prev) => ({
        ...(prev ?? EMPTY_WORKFLOW_GENERATOR_MODEL),
        provider: newValue.provider,
        name: newValue.modelId,
        mode: newValue.mode as ModelModeType,
      }))
    },
    [setModel],
  )

  const handleCompletionParamsChange = useCallback(
    (newParams: FormValue) => {
      setModel((prev) => ({
        ...(prev ?? EMPTY_WORKFLOW_GENERATOR_MODEL),
        completion_params: newParams as CompletionParams,
      }))
    },
    [setModel],
  )

  const [lastInstruction, setLastInstruction] = useWorkflowGeneratorLastInstruction()
  // Seed from the palette's inline-captured instruction, else the last instruction
  // generated from (persisted across opens). Captured at mount only — the modal
  // remounts on each open, so this is just the initial value.
  const [instruction, setInstruction] = useState(initialInstruction || lastInstruction || '')
  // Planner result, streamed ahead of the graph (null until it lands).
  const [plan, setPlan] = useState<WorkflowGenPlan | null>(null)
  // Structured generation errors (validation / model). Drives the actionable
  // error panel; null when the last attempt succeeded or hasn't run.
  const [genError, setGenError] = useState<GenError[] | null>(null)
  // Refine base graph captured at Generate time, diffed against the result so
  // the user can see what "apply" changes before overwriting their draft.
  const [refineBaseGraph, setRefineBaseGraph] = useState<GeneratedGraph | null>(null)

  const storageKey = `${mode}-${currentAppId ?? 'new'}`
  const { addVersion, current, currentVersionIndex, setCurrentVersionIndex, versions } =
    useGenGraph({
      storageKey,
    })

  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const [isApplying, { setTrue: setApplyingTrue, setFalse: setApplyingFalse }] = useBoolean(false)

  // Confirmation dialog for "Apply to current draft"
  const [
    isShowConfirmOverwrite,
    { setTrue: showConfirmOverwrite, setFalse: hideConfirmOverwrite },
  ] = useBoolean(false)

  // Surfaced when the backend rejects the draft sync because another tab
  // edited the workspace after we fetched it. Dedicated dialog instead of a
  // toast because the user needs an explicit Reload action — without that,
  // a generic "apply failed" toast leaves them stuck and confused.
  const [isShowHashCollision, { setTrue: showHashCollision, setFalse: hideHashCollision }] =
    useBoolean(false)

  // Holds the AbortController of the in-flight ``/workflow-generate`` request
  // so we can cancel it on (a) modal close, (b) a second Generate click
  // while loading, (c) the hard 60 s frontend timeout, or (d) the user
  // pressing Cancel. Without this an in-flight request outlives the modal
  // and can race a future Generate call.
  const abortRef = useRef<AbortController | null>(null)
  // Companion timer so the timeout doesn't keep running after the response
  // lands. Cleared inside the same ``finally`` block that flips loading off.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mode the user generated against. If they switch app context mid-flight
  // (e.g. open the same modal from a different Studio in another tab) we
  // hide the "Apply to current" button so the wrong-mode graph never lands
  // in the wrong Studio. Captured at Generate time, not Apply time.
  const generatedModeRef = useRef<typeof mode | null>(null)

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const abortInFlight = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    clearTimers()
  }, [clearTimers])

  // Cleanup on unmount — a modal unmount mid-generation must NOT leave the
  // request running in the background (it would still resolve, mutate the
  // store, and toast "applied" against a stale modal).
  useEffect(() => {
    return () => {
      abortInFlight()
    }
    // The cleanup function reads refs only, so it's stable; we intentionally
    // exclude ``abortInFlight`` from deps to avoid re-running this effect on
    // every render.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [])

  // Note: the modal is mounted lazily by ``mount.tsx`` which unmounts it when
  // ``isOpen`` flips to false, so transient state (instruction / plan / errors)
  // resets implicitly on the next open. No reset effect needed.

  const isValid = () => {
    const trimmed = instruction.trim()
    if (!trimmed) {
      toast.error(t(($) => $['workflowGenerator.instructionRequired']))
      return false
    }
    if (!model.name) {
      // No usable model resolved (provider catalogue empty or still
      // loading). Without this guard the request would fly with an empty
      // ``model_config.name`` and surface as a backend 400 — not actionable
      // for the user. Tell them to pick a model.
      toast.error(t(($) => $['workflowGenerator.modelRequired']))
      return false
    }
    return true
  }

  // Apply a finished generation result (from the stream's ``result`` event or
  // the non-streaming fallback). Structured errors go to the actionable error
  // panel rather than a transient toast; a version is added only for a real graph.
  const handleResult = useCallback(
    (res: StreamResult) => {
      if (res.errors?.length) {
        setGenError(res.errors as GenError[])
        return
      }
      if (!res.graph?.nodes?.length) {
        setGenError([
          { code: 'EMPTY', detail: res.error || t(($) => $['workflowGenerator.generateFailed']) },
        ])
        return
      }
      setGenError(null)
      addVersion(res)
    },
    [addVersion, t],
  )

  const onGenerate = async () => {
    if (!isValid()) return
    // Cancel any previous in-flight request (double-click guard).
    abortInFlight()

    generatedModeRef.current = mode
    setLastInstruction(instruction)
    setGenError(null)
    setPlan(null)
    setLoadingTrue()

    // Hard frontend timeout — aborts the request and surfaces a localised toast
    // instead of a perpetual spinner if the backend hangs.
    timeoutRef.current = setTimeout(() => {
      abortRef.current?.abort()
      abortRef.current = null
      toast.error(t(($) => $['workflowGenerator.errors.timeout']))
      setLoadingFalse()
    }, FE_TIMEOUT_MS)

    // Refine mode: pull the current draft so the backend amends it instead of
    // starting from scratch. The modal mounts outside the Studio's ReactFlow
    // provider, so we read the persisted draft rather than the live canvas. A
    // fetch failure (no draft yet) degrades to from-scratch generation, but we
    // warn since the user explicitly asked to refine.
    let currentGraph: GeneratedGraph | undefined
    if (isRefine && currentAppId) {
      try {
        const draft = await fetchWorkflowDraft(`apps/${currentAppId}/workflows/draft`)
        if (draft?.graph?.nodes?.length) currentGraph = draft.graph as GeneratedGraph
      } catch {
        currentGraph = undefined
      }
      if (!currentGraph) toast.warning(t(($) => $['workflowGenerator.refineDraftUnavailable']))
    }
    setRefineBaseGraph(currentGraph ?? null)

    const body: GenerateWorkflowBody = {
      // Auto-mode sends 'auto' so the planner picks Workflow vs Chatflow; the
      // resolved concrete mode comes back on the result and drives apply.
      mode: autoMode ? 'auto' : mode,
      instruction,
      model_config: model,
      ...(currentGraph ? { current_graph: currentGraph } : {}),
    }

    const finish = () => {
      setLoadingFalse()
      clearTimers()
      abortRef.current = null
    }

    // Plan-first streaming: surface the planner outline the moment it lands, then
    // the graph. ``settled`` tracks whether the stream produced anything, so a
    // stream that dies before any event (endpoint missing, proxy buffering) can
    // fall back to the single-shot endpoint instead of failing the user.
    let settled = false
    generateWorkflowStream(body, {
      getAbortController: (c) => {
        abortRef.current = c
      },
      onPlan: (p) => {
        settled = true
        setPlan(p)
      },
      onResult: (res) => {
        settled = true
        handleResult(res)
        finish()
      },
      onError: (msg) => {
        if (!settled) {
          generateWorkflow(body, {
            getAbortController: (c) => {
              abortRef.current = c
            },
          })
            .then((res) => handleResult(res))
            .catch((e: unknown) => {
              if (isAbortError(e)) return
              const message = e instanceof Error ? e.message : ''
              toast.error(message || t(($) => $['workflowGenerator.generateFailed']))
            })
            .finally(finish)
          return
        }
        if (msg) toast.error(msg)
        finish()
      },
      onCompleted: () => {
        if (settled) finish()
      },
    })
  }

  const onCancelGeneration = useCallback(() => {
    abortInFlight()
    setLoadingFalse()
  }, [abortInFlight, setLoadingFalse])

  // "Apply to current" is valid only when the visible graph was generated
  // for the app we'd be writing to. We require: a current app exists, its
  // mode matches the current modal mode, AND the last Generate (if any)
  // ran in this same mode — otherwise the user switched tabs mid-flight
  // and we'd be writing a workflow graph into a chatflow draft (or vice
  // versa). Falls back to "Create new app" only.
  const generatedMode = generatedModeRef.current
  const generatedModeMatches = generatedMode === null || generatedMode === mode
  const canApplyToCurrent = !!currentAppId && currentAppMode === mode && generatedModeMatches

  const handleApplyToNew = useCallback(async () => {
    if (!current?.graph || isApplying) return
    setApplyingTrue()
    try {
      const { appId, appMode, permissionKeys } = await applyToNewApp({
        // Resolved mode — when the request used auto-mode this is the concrete
        // type the planner picked, so the new app is created as the right kind.
        mode: current.mode ?? mode,
        graph: current.graph as GeneratedGraph,
        instruction,
        appName: current.app_name,
        icon: current.icon,
      })
      // Nudge the freshly-created Studio toward iterating with cmd+k /refine
      // instead of regenerating from scratch for a small tweak.
      toast.success(t(($) => $['workflowGenerator.appliedRefineHint']))
      closeGenerator()
      router.push(
        getRedirectionPath(
          { id: appId, mode: appMode, permission_keys: permissionKeys },
          { isRbacEnabled },
        ),
      )
    } catch (e: unknown) {
      if (e instanceof WorkflowApplyOrphanError) {
        // Sync failed AND we couldn't roll back. Route the user to /apps so
        // the orphan is still discoverable — they can delete it by hand.
        toast.error(t(($) => $['workflowGenerator.errors.apply_failed_orphan']))
        closeGenerator()
        router.push('/apps')
        return
      }
      const message = e instanceof Error ? e.message : ''
      toast.error(message || t(($) => $['workflowGenerator.applyFailed']))
    } finally {
      setApplyingFalse()
    }
  }, [
    current,
    instruction,
    mode,
    router,
    closeGenerator,
    t,
    isApplying,
    isRbacEnabled,
    setApplyingTrue,
    setApplyingFalse,
  ])

  const handleApplyToCurrentConfirmed = useCallback(async () => {
    if (!current?.graph || !currentAppId || isApplying) return
    hideConfirmOverwrite()
    setApplyingTrue()
    try {
      await applyToCurrentApp({ appId: currentAppId, graph: current.graph as GeneratedGraph })
      toast.success(t(($) => $['workflowGenerator.applied']))
      closeGenerator()
      // Hard reload the workflow page so the canvas picks up the new draft —
      // ``router.refresh()`` only revalidates server-rendered route data, and
      // the Studio canvas is hydrated client-side via react-query / zustand.
      if (typeof window !== 'undefined') window.location.reload()
    } catch (e: unknown) {
      if (e instanceof WorkflowApplyHashCollisionError) {
        // Another tab edited the draft after we fetched it. Show a
        // dedicated dialog with a Reload affordance instead of a generic
        // "apply failed" toast — the user needs to know what actually
        // happened so they can pick up the other tab's edits before
        // retrying.
        showHashCollision()
        return
      }
      const message = e instanceof Error ? e.message : ''
      toast.error(message || t(($) => $['workflowGenerator.applyFailed']))
    } finally {
      setApplyingFalse()
    }
  }, [
    current,
    currentAppId,
    hideConfirmOverwrite,
    closeGenerator,
    t,
    isApplying,
    setApplyingTrue,
    setApplyingFalse,
    showHashCollision,
  ])

  const modeLabel =
    mode === 'workflow'
      ? t(($) => $['workflowGenerator.modes.workflow'])
      : t(($) => $['workflowGenerator.modes.chatflow'])

  // Refine diff — what an "apply" would change vs. the draft we started from.
  const refineDiff = useMemo(() => {
    if (!isRefine || !refineBaseGraph || !current?.graph?.nodes?.length) return null
    return diffGraphs(refineBaseGraph, current.graph as GeneratedGraph)
  }, [isRefine, refineBaseGraph, current])
  const hasRefineChanges =
    !!refineDiff &&
    (refineDiff.added.length > 0 || refineDiff.removed.length > 0 || refineDiff.changed.length > 0)

  // Derived view of the last structured error for the actionable error panel.
  const firstGenError = genError?.[0]
  const genErrorMessage = firstGenError ? getWorkflowGeneratorErrorMessage(firstGenError, t) : ''
  const genErrorHasUnknownTool = !!genError?.some((e) => e.code === 'UNKNOWN_TOOL')

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          // Cancel any in-flight request BEFORE closing the store — a
          // request that resolves after the modal closes would still toast
          // against the now-unmounted modal and pollute version history.
          abortInFlight()
          closeGenerator()
        }
      }}
    >
      <DialogContent className="h-[min(680px,calc(100dvh-2rem))] max-h-none! w-[1140px] max-w-none! min-w-[1140px] overflow-hidden! border-none p-0! text-left align-middle">
        <div className="flex h-full min-h-0 flex-wrap">
          {/* Left pane: instructions + ideal output + model selector */}
          <div className="h-full w-[570px] shrink-0 overflow-y-auto border-r border-divider-regular p-6">
            <div className="mb-5">
              <div className="text-lg leading-[28px] font-bold text-text-primary">
                {isRefine
                  ? t(($) => $['workflowGenerator.refineTitle'], { mode: modeLabel })
                  : t(($) => $['workflowGenerator.title'], { mode: modeLabel })}
              </div>
              <div className="mt-1 text-[13px] font-normal text-text-tertiary">
                {isRefine
                  ? t(($) => $['workflowGenerator.refineDescription'])
                  : t(($) => $['workflowGenerator.description'])}
              </div>
            </div>

            <div>
              <ModelParameterModal
                popupClassName="w-[520px]!"
                isAdvancedMode={true}
                provider={model.provider}
                completionParams={model.completion_params}
                modelId={model.name}
                setModel={handleModelChange}
                onCompletionParamsChange={handleCompletionParamsChange}
                hideDebugWithMultipleModel
              />
            </div>

            <div className="mt-4">
              <div className="mb-1.5 system-sm-semibold-uppercase text-text-secondary">
                {t(($) => $['workflowGenerator.instruction'])}
              </div>
              <Textarea
                // Autofocus is appropriate here: the modal's sole purpose is to
                // capture an instruction, so focusing it on open aids the flow.
                // oxlint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="h-[160px]"
                placeholder={
                  isRefine
                    ? t(($) => $['workflowGenerator.refineInstructionPlaceholder'])
                    : t(($) => $['workflowGenerator.instructionPlaceholder'])
                }
                value={instruction}
                onValueChange={setInstruction}
                onKeyDown={(e) => {
                  // ⌘/Ctrl+Enter generates — the journey starts keyboard-first in
                  // the palette, so let it finish without reaching for the mouse.
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    if (!isLoading) onGenerate()
                  }
                }}
                maxLength={MAX_INSTRUCTION_LENGTH}
              />

              {/* Example prompts are create-from-scratch starters ("Summarize a
                  URL"); they don't fit a refine-the-current-graph task, so hide
                  them in refine mode. */}
              {!isRefine && <ExamplePrompts mode={mode} onSelect={setInstruction} />}

              <div className="mt-7 flex justify-end space-x-2">
                <Button onClick={closeGenerator}>{t(($) => $['workflowGenerator.dismiss'])}</Button>
                {isLoading ? (
                  // Cancel surfaces the abort affordance during the 60 s
                  // window where the user might want to bail (slow
                  // model, wrong instruction, etc.). Hidden when idle so
                  // the row stays focused on the primary action.
                  <Button
                    className="flex space-x-1"
                    variant="secondary"
                    onClick={onCancelGeneration}
                  >
                    <span className="text-xs font-semibold">
                      {t(($) => $['workflowGenerator.cancel'])}
                    </span>
                  </Button>
                ) : (
                  <Button
                    className="flex space-x-1"
                    variant="primary"
                    onClick={onGenerate}
                    disabled={!model.name}
                  >
                    <span className="i-custom-vender-other-generator size-4" />
                    <span className="text-xs font-semibold">
                      {t(($) => $['workflowGenerator.generate'])}
                    </span>
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Right pane: planning → graph result / actionable error / empty placeholder */}
          {isLoading ? (
            <GenerationPlan plan={plan} />
          ) : genError?.length ? (
            <div className="flex h-full w-0 grow flex-col items-center justify-center gap-4 px-8">
              <RiErrorWarningLine className="size-8 text-text-quaternary" />
              <div className="text-center">
                <div className="system-md-medium text-text-secondary">{genErrorMessage}</div>
                {firstGenError?.node_id && (
                  <div className="mt-1 system-xs-regular text-text-tertiary">
                    {t(($) => $['workflowGenerator.errors.atNode'], {
                      node: firstGenError.node_id,
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="small" variant="primary" onClick={onGenerate} disabled={!model.name}>
                  {t(($) => $['workflowGenerator.regenerate'])}
                </Button>
                {genErrorHasUnknownTool && (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      closeGenerator()
                      router.push('/tools')
                    }}
                  >
                    {t(($) => $['workflowGenerator.errors.installTools'])}
                  </Button>
                )}
              </div>
            </div>
          ) : current?.graph?.nodes?.length ? (
            <div className="flex h-full w-0 grow flex-col bg-background-default-subtle p-6">
              {/* Planner-picked identity — surfaces the app_name + icon the
                          UI used to discard so the user sees what they'll create. */}
              {(current.icon || current.app_name) && (
                <div className="mb-2 flex items-center gap-2">
                  {current.icon && <span className="text-lg leading-none">{current.icon}</span>}
                  {current.app_name && (
                    <span className="truncate text-sm font-semibold text-text-primary">
                      {current.app_name}
                    </span>
                  )}
                </div>
              )}
              <div className="mb-3 flex items-center justify-between">
                <VersionSelector
                  versionLen={versions?.length || 0}
                  value={currentVersionIndex || 0}
                  onChange={setCurrentVersionIndex}
                />
                <div className="flex items-center space-x-2">
                  {canApplyToCurrent ? (
                    // Studio button entry — overwrite the current draft
                    // is the only meaningful Apply action, so collapse
                    // the two buttons into one primary "Apply".
                    <Button
                      size="small"
                      variant="primary"
                      onClick={showConfirmOverwrite}
                      disabled={isApplying}
                    >
                      {t(($) => $['workflowGenerator.studioApply'])}
                    </Button>
                  ) : (
                    // cmd+k /create entry — no current-app context, so
                    // the only path is "Create new app".
                    <Button
                      size="small"
                      variant="primary"
                      onClick={handleApplyToNew}
                      disabled={isApplying}
                    >
                      {t(($) => $['workflowGenerator.applyToNew'])}
                    </Button>
                  )}
                </div>
              </div>
              <div className="relative w-full grow overflow-hidden rounded-2xl border border-divider-subtle bg-background-default">
                <WorkflowPreview
                  nodes={current.graph.nodes}
                  edges={current.graph.edges}
                  viewport={current.graph.viewport}
                  miniMapToRight
                />
              </div>
              {/* Refine diff — what an apply changes vs. the draft we started from. */}
              {hasRefineChanges && refineDiff && (
                <div className="mt-2 system-xs-regular text-text-tertiary">
                  {t(($) => $['workflowGenerator.diff.summary'], {
                    added: refineDiff.added.length,
                    removed: refineDiff.removed.length,
                    changed: refineDiff.changed.length,
                  })}
                </div>
              )}
              {current.message && (
                <div className="mt-2 system-xs-regular text-text-tertiary">{current.message}</div>
              )}
            </div>
          ) : (
            renderPlaceholder(t(($) => $['workflowGenerator.placeholder']))
          )}
        </div>

        <RecoveryDialog
          open={isShowConfirmOverwrite}
          onOpenChange={() => hideConfirmOverwrite()}
          title={t(($) => $['workflowGenerator.overwriteTitle'])}
          description={t(($) => $['workflowGenerator.overwriteMessage'])}
          cancelLabel={t(($) => $['operation.cancel'], { ns: 'common' })}
          confirmLabel={t(($) => $['operation.confirm'], { ns: 'common' })}
          onConfirm={handleApplyToCurrentConfirmed}
        />

        {/* Hash-collision recovery — surfaces when another tab edited the
            draft between our fetch and sync. Reload picks up those edits;
            Dismiss returns to the modal so the user can copy the generated
            graph manually before re-fetching. */}
        <RecoveryDialog
          open={isShowHashCollision}
          onOpenChange={() => hideHashCollision()}
          title={t(($) => $['workflowGenerator.errors.hash_collision_title'])}
          description={t(($) => $['workflowGenerator.errors.hash_collision'])}
          cancelLabel={t(($) => $['operation.cancel'], { ns: 'common' })}
          confirmLabel={t(($) => $['workflowGenerator.reload'])}
          onConfirm={() => {
            hideHashCollision()
            if (typeof window !== 'undefined') window.location.reload()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(WorkflowGeneratorModal)
