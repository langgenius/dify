'use client'
import type { GeneratedGraph } from './types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
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
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import IdeaOutput from '@/app/components/app/configuration/config/automatic/idea-output'
import VersionSelector from '@/app/components/app/configuration/config/automatic/version-selector'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { generateWorkflow } from '@/service/debug'
import { fetchWorkflowDraft } from '@/service/workflow'
import { getRedirectionPath } from '@/utils/app-redirection'
import { applyToCurrentApp, applyToNewApp, WorkflowApplyHashCollisionError, WorkflowApplyOrphanError } from './apply'
import ExamplePrompts from './example-prompts'
import GenerationPhases from './generation-phases'
import { EMPTY_WORKFLOW_GENERATOR_MODEL, useWorkflowGeneratorModel } from './storage'
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

const renderPlaceholder = (label: string) => (
  <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3 px-8">
    <span className="i-custom-vender-other-generator size-8 text-text-quaternary" />
    <div className="text-center text-[13px] leading-5 font-normal text-text-tertiary">
      {label}
    </div>
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
const RecoveryDialog = ({ open, onOpenChange, title, description, cancelLabel, confirmLabel, onConfirm }: RecoveryDialogProps) => (
  <AlertDialog open={open} onOpenChange={o => !o && onOpenChange(false)}>
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

  const isOpen = useWorkflowGeneratorStore(s => s.isOpen)
  const mode = useWorkflowGeneratorStore(s => s.mode)
  const intent = useWorkflowGeneratorStore(s => s.intent)
  const currentAppId = useWorkflowGeneratorStore(s => s.currentAppId)
  const currentAppMode = useWorkflowGeneratorStore(s => s.currentAppMode)
  const closeGenerator = useWorkflowGeneratorStore(s => s.closeGenerator)

  const isRefine = intent === 'refine' && !!currentAppId

  const [model, setModel] = useWorkflowGeneratorModel()

  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  // Hydrate model from defaultModel once it loads (async). We deliberately set state
  // from an effect here because defaultModel only resolves after the workspace's model
  // catalogue fetch completes.
  useEffect(() => {
    if (defaultModel && !model.name) {
      setModel(prev => ({
        ...(prev ?? EMPTY_WORKFLOW_GENERATOR_MODEL),
        name: defaultModel.model,
        provider: defaultModel.provider.provider,
      }))
    }
  }, [defaultModel, model.name, setModel])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    setModel(prev => ({
      ...(prev ?? EMPTY_WORKFLOW_GENERATOR_MODEL),
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }))
  }, [setModel])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    setModel(prev => ({
      ...(prev ?? EMPTY_WORKFLOW_GENERATOR_MODEL),
      completion_params: newParams as CompletionParams,
    }))
  }, [setModel])

  const [instruction, setInstruction] = useState('')
  const [ideaOutput, setIdeaOutput] = useState('')

  const storageKey = `${mode}-${currentAppId ?? 'new'}`
  const { addVersion, current, currentVersionIndex, setCurrentVersionIndex, versions } = useGenGraph({
    storageKey,
  })

  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const [isApplying, { setTrue: setApplyingTrue, setFalse: setApplyingFalse }] = useBoolean(false)

  // Per-attempt nonce — bumped on each Generate click so ``GenerationPhases``
  // can reset its internal phase timer instead of resuming wherever the
  // previous attempt left off (which makes the UI look wedged).
  const [startedAt, setStartedAt] = useState(0)

  // Confirmation dialog for "Apply to current draft"
  const [isShowConfirmOverwrite, { setTrue: showConfirmOverwrite, setFalse: hideConfirmOverwrite }] = useBoolean(false)

  // Surfaced when the backend rejects the draft sync because another tab
  // edited the workspace after we fetched it. Dedicated dialog instead of a
  // toast because the user needs an explicit Reload action — without that,
  // a generic "apply failed" toast leaves them stuck and confused.
  const [isShowHashCollision, { setTrue: showHashCollision, setFalse: hideHashCollision }] = useBoolean(false)

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
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // Note: the modal is mounted lazily by ``mount.tsx`` which unmounts it when
  // ``isOpen`` flips to false, so transient state (instruction / ideaOutput)
  // resets implicitly on the next open. No reset effect needed.

  const isValid = () => {
    const trimmed = instruction.trim()
    if (!trimmed) {
      toast.error(t('workflowGenerator.instructionRequired'))
      return false
    }
    if (!model.name) {
      // No usable model resolved (provider catalogue empty or still
      // loading). Without this guard the request would fly with an empty
      // ``model_config.name`` and surface as a backend 400 — not actionable
      // for the user. Tell them to pick a model.
      toast.error(t('workflowGenerator.modelRequired'))
      return false
    }
    return true
  }

  const onGenerate = async () => {
    if (!isValid())
      return
    // Cancel any previous in-flight request (double-click guard). The
    // previous promise will reject with AbortError which our catch swallows.
    abortInFlight()

    setStartedAt(Date.now())
    generatedModeRef.current = mode
    setLoadingTrue()

    // Hard frontend timeout — aborts the request and surfaces a localised
    // toast so the user sees something actionable instead of a perpetual
    // spinner if the backend hangs.
    timeoutRef.current = setTimeout(() => {
      abortRef.current?.abort()
      abortRef.current = null
      toast.error(t('workflowGenerator.errors.timeout'))
    }, FE_TIMEOUT_MS)

    try {
      // Refine mode: pull the current draft graph so the backend amends it
      // instead of starting from scratch. The modal mounts outside the Studio's
      // ReactFlow provider, so we read the persisted draft rather than the live
      // canvas. A fetch failure (no draft saved yet) degrades gracefully to a
      // from-scratch generation — better than blocking the user entirely — but
      // the user asked to REFINE, so tell them their draft isn't being used
      // instead of silently generating something unrelated.
      let currentGraph: Awaited<ReturnType<typeof fetchWorkflowDraft>>['graph'] | undefined
      if (isRefine && currentAppId) {
        try {
          const draft = await fetchWorkflowDraft(`apps/${currentAppId}/workflows/draft`)
          if (draft?.graph?.nodes?.length)
            currentGraph = draft.graph
        }
        catch {
          currentGraph = undefined
        }
        if (!currentGraph)
          toast.warning(t('workflowGenerator.refineDraftUnavailable'))
      }

      const res = await generateWorkflow({
        mode,
        instruction,
        ideal_output: ideaOutput,
        model_config: model,
        ...(currentGraph ? { current_graph: currentGraph } : {}),
      }, {
        getAbortController: (c) => { abortRef.current = c },
      })
      const first = res.errors?.[0]
      if (first) {
        // Prefer the localised copy for the structured code; fall back to
        // the backend's human-readable ``detail`` for codes we don't have
        // a translation for yet.
        const i18nKey = `workflowGenerator.errors.${first.code}`
        const localised = t(i18nKey, { defaultValue: '' })
        toast.error(localised || first.detail || res.error || t('workflowGenerator.generateFailed'))
        return
      }
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (!res.graph?.nodes?.length) {
        // Defensive: a success envelope with an empty graph should never
        // leave the backend, but if it does, an empty "version" would just
        // pollute the selector with a blank preview.
        toast.error(t('workflowGenerator.generateFailed'))
        return
      }
      addVersion(res)
    }
    catch (e: unknown) {
      // Aborts are intentional (modal close, second click, timeout) — never
      // toast for them. The timeout path already showed its own toast.
      if (isAbortError(e))
        return
      const message = e instanceof Error ? e.message : ''
      toast.error(message || t('workflowGenerator.generateFailed'))
    }
    finally {
      setLoadingFalse()
      clearTimers()
      abortRef.current = null
    }
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
    if (!current?.graph || isApplying)
      return
    setApplyingTrue()
    try {
      const { appId, appMode, permissionKeys } = await applyToNewApp({
        mode,
        graph: current.graph as GeneratedGraph,
        instruction,
        appName: current.app_name,
        icon: current.icon,
      })
      toast.success(t('workflowGenerator.applied'))
      closeGenerator()
      router.push(getRedirectionPath({ id: appId, mode: appMode, permission_keys: permissionKeys }, { isRbacEnabled }))
    }
    catch (e: unknown) {
      if (e instanceof WorkflowApplyOrphanError) {
        // Sync failed AND we couldn't roll back. Route the user to /apps so
        // the orphan is still discoverable — they can delete it by hand.
        toast.error(t('workflowGenerator.errors.apply_failed_orphan'))
        closeGenerator()
        router.push('/apps')
        return
      }
      const message = e instanceof Error ? e.message : ''
      toast.error(message || t('workflowGenerator.applyFailed'))
    }
    finally {
      setApplyingFalse()
    }
  }, [current, instruction, mode, router, closeGenerator, t, isApplying, isRbacEnabled, setApplyingTrue, setApplyingFalse])

  const handleApplyToCurrentConfirmed = useCallback(async () => {
    if (!current?.graph || !currentAppId || isApplying)
      return
    hideConfirmOverwrite()
    setApplyingTrue()
    try {
      await applyToCurrentApp({ appId: currentAppId, graph: current.graph as GeneratedGraph })
      toast.success(t('workflowGenerator.applied'))
      closeGenerator()
      // Hard reload the workflow page so the canvas picks up the new draft —
      // ``router.refresh()`` only revalidates server-rendered route data, and
      // the Studio canvas is hydrated client-side via react-query / zustand.
      if (typeof window !== 'undefined')
        window.location.reload()
    }
    catch (e: unknown) {
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
      toast.error(message || t('workflowGenerator.applyFailed'))
    }
    finally {
      setApplyingFalse()
    }
  }, [current, currentAppId, hideConfirmOverwrite, closeGenerator, t, isApplying, setApplyingTrue, setApplyingFalse, showHashCollision])

  const modeLabel = mode === 'workflow' ? t('workflowGenerator.modes.workflow') : t('workflowGenerator.modes.chatflow')

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
                  ? t('workflowGenerator.refineTitle', { mode: modeLabel })
                  : t('workflowGenerator.title', { mode: modeLabel })}
              </div>
              <div className="mt-1 text-[13px] font-normal text-text-tertiary">
                {isRefine ? t('workflowGenerator.refineDescription') : t('workflowGenerator.description')}
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
                {t('workflowGenerator.instruction')}
              </div>
              <Textarea
                className="h-[160px]"
                placeholder={isRefine
                  ? t('workflowGenerator.refineInstructionPlaceholder')
                  : t('workflowGenerator.instructionPlaceholder')}
                value={instruction}
                onValueChange={setInstruction}
                maxLength={MAX_INSTRUCTION_LENGTH}
              />

              {/* Example prompts are create-from-scratch starters ("Summarize a
                  URL"); they don't fit a refine-the-current-graph task, so hide
                  them in refine mode. */}
              {!isRefine && <ExamplePrompts mode={mode} onSelect={setInstruction} />}

              <IdeaOutput
                value={ideaOutput}
                onChange={setIdeaOutput}
              />

              <div className="mt-7 flex justify-end space-x-2">
                <Button onClick={closeGenerator}>
                  {t('workflowGenerator.dismiss')}
                </Button>
                {isLoading
                  ? (
                      // Cancel surfaces the abort affordance during the 60 s
                      // window where the user might want to bail (slow
                      // model, wrong instruction, etc.). Hidden when idle so
                      // the row stays focused on the primary action.
                      <Button
                        className="flex space-x-1"
                        variant="secondary"
                        onClick={onCancelGeneration}
                      >
                        <span className="text-xs font-semibold">{t('workflowGenerator.cancel')}</span>
                      </Button>
                    )
                  : (
                      <Button
                        className="flex space-x-1"
                        variant="primary"
                        onClick={onGenerate}
                        disabled={!model.name}
                      >
                        <span className="i-custom-vender-other-generator size-4" />
                        <span className="text-xs font-semibold">{t('workflowGenerator.generate')}</span>
                      </Button>
                    )}
              </div>
            </div>
          </div>

          {/* Right pane: preview + version selector + apply */}
          {(!isLoading && current?.graph?.nodes?.length)
            ? (
                <div className="flex h-full w-0 grow flex-col bg-background-default-subtle p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <VersionSelector
                      versionLen={versions?.length || 0}
                      value={currentVersionIndex || 0}
                      onChange={setCurrentVersionIndex}
                    />
                    <div className="flex items-center space-x-2">
                      {canApplyToCurrent
                        ? (
                            // Studio button entry — overwrite the current draft
                            // is the only meaningful Apply action, so collapse
                            // the two buttons into one primary "Apply".
                            <Button
                              size="small"
                              variant="primary"
                              onClick={showConfirmOverwrite}
                              disabled={isApplying}
                            >
                              {t('workflowGenerator.studioApply')}
                            </Button>
                          )
                        : (
                            // cmd+k /create entry — no current-app context, so
                            // the only path is "Create new app".
                            <Button
                              size="small"
                              variant="primary"
                              onClick={handleApplyToNew}
                              disabled={isApplying}
                            >
                              {t('workflowGenerator.applyToNew')}
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
                  {current.message && (
                    <div className="mt-2 system-xs-regular text-text-tertiary">
                      {current.message}
                    </div>
                  )}
                </div>
              )
            : null}

          {isLoading && <GenerationPhases startedAt={startedAt} />}

          {!isLoading && !current?.graph?.nodes?.length && renderPlaceholder(t('workflowGenerator.placeholder'))}
        </div>

        <RecoveryDialog
          open={isShowConfirmOverwrite}
          onOpenChange={() => hideConfirmOverwrite()}
          title={t('workflowGenerator.overwriteTitle')}
          description={t('workflowGenerator.overwriteMessage')}
          cancelLabel={t('operation.cancel', { ns: 'common' })}
          confirmLabel={t('operation.confirm', { ns: 'common' })}
          onConfirm={handleApplyToCurrentConfirmed}
        />

        {/* Hash-collision recovery — surfaces when another tab edited the
            draft between our fetch and sync. Reload picks up those edits;
            Dismiss returns to the modal so the user can copy the generated
            graph manually before re-fetching. */}
        <RecoveryDialog
          open={isShowHashCollision}
          onOpenChange={() => hideHashCollision()}
          title={t('workflowGenerator.errors.hash_collision_title')}
          description={t('workflowGenerator.errors.hash_collision')}
          cancelLabel={t('operation.cancel', { ns: 'common' })}
          confirmLabel={t('workflowGenerator.reload')}
          onConfirm={() => {
            hideHashCollision()
            if (typeof window !== 'undefined')
              window.location.reload()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(WorkflowGeneratorModal)
