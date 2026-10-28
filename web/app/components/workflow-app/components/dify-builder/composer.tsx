import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import TextareaAutosize from 'react-textarea-autosize'
import { useDifyBuilderInteractionLocale } from './interactions/use-interaction-locale'
import DifyBuilderModelSelector from './model-selector'
import { DifyBuilderModelStatus } from './model-status'
import { difyBuilderSessionErrorCodeAtom, difyBuilderTaskControlAtom } from './session/state'
import {
  difyBuilderCanComposeAtom,
  difyBuilderCanControlTaskAtom,
  difyBuilderCanSendDraftAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderControlTaskAtom,
  difyBuilderDraftAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderSendDraftAtom,
  difyBuilderTaskControlOperationAtom,
} from './store'
import { useDifyBuilderModel } from './use-dify-builder-model'

const COMPOSITION_END_DELAY = 50

const DifyBuilderPromptInput = ({ descriptionId }: { descriptionId?: string }) => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const [draft, setDraft] = useAtom(difyBuilderDraftAtom)
  const canCompose = useAtomValue(difyBuilderCanComposeAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const isComposingRef = useRef(false)
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const placeholder = canCompose
    ? t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })
    : interactionBusy
      ? t(($) => $.workingPlaceholder, { ns: 'difyBuilder' })
      : t(($) => $.inputUnavailable, { ns: 'difyBuilder' })

  useEffect(() => {
    return () => {
      if (compositionEndTimerRef.current) clearTimeout(compositionEndTimerRef.current)
    }
  }, [])

  return (
    <TextareaAutosize
      value={draft}
      minRows={2}
      maxRows={8}
      disabled={!canCompose}
      aria-label={t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })}
      aria-describedby={descriptionId}
      placeholder={placeholder}
      className="block w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-2 py-1 text-sm leading-5 tracking-[-0.07px] text-text-primary caret-[#295EFF] outline-hidden placeholder:text-text-placeholder disabled:cursor-not-allowed"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onCompositionStart={() => {
        if (compositionEndTimerRef.current) clearTimeout(compositionEndTimerRef.current)
        compositionEndTimerRef.current = null
        isComposingRef.current = true
      }}
      onCompositionEnd={() => {
        compositionEndTimerRef.current = setTimeout(() => {
          compositionEndTimerRef.current = null
          isComposingRef.current = false
        }, COMPOSITION_END_DELAY)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || !draft.trim()) return
        if (event.nativeEvent.isComposing || isComposingRef.current) return
        event.preventDefault()
        event.currentTarget.form?.requestSubmit()
      }}
    />
  )
}

const DifyBuilderComposerAction = ({
  hasModel,
  descriptionId,
}: {
  hasModel: boolean
  descriptionId?: string
}) => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const canSend = useAtomValue(difyBuilderCanSendDraftAtom) && hasModel
  const canControl = useAtomValue(difyBuilderCanControlTaskAtom)
  const operation = useAtomValue(difyBuilderTaskControlOperationAtom)
  const control = useAtomValue(difyBuilderTaskControlAtom)
  const controlTask = useSetAtom(difyBuilderControlTaskAtom)
  const pending = control !== null && control.phase !== 'unknown'
  const label =
    operation === 'stop'
      ? t(($) => $['taskControl.stop'])
      : operation === 'resume'
        ? t(($) => $['taskControl.resume'])
        : t(($) => $.messageSend)
  const icon = pending
    ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
    : operation === 'stop'
      ? 'i-ri-stop-fill'
      : operation === 'resume'
        ? 'i-ri-play-fill'
        : 'i-ri-send-plane-2-fill'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            type={operation ? 'button' : 'submit'}
            size="lg"
            variant="primary"
            disabled={operation ? !canControl : !canSend}
            focusableWhenDisabled={pending}
            aria-label={label}
            aria-describedby={descriptionId}
            onClick={
              operation
                ? (event) => {
                    // A fast Resume can turn this same button into Stop before
                    // the second click of a double-click reaches it.
                    if (event.detail > 1) return
                    void controlTask()
                  }
                : undefined
            }
          >
            <span aria-hidden className={`${icon} size-4`} />
          </IconButton>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const DifyBuilderComposer = () => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const sendDraft = useSetAtom(difyBuilderSendDraftAtom)
  const modelState = useDifyBuilderModel()
  const { model } = modelState
  const hasModel = model !== null
  const rejected = useAtomValue(difyBuilderSessionErrorCodeAtom) === 'model_unavailable'
  const statusId = useId()
  const showStatus = !hasModel || rejected
  const control = useAtomValue(difyBuilderTaskControlAtom)
  const operation = useAtomValue(difyBuilderTaskControlOperationAtom)
  const canvasReady = useAtomValue(difyBuilderCanvasReadyAtom)
  const controlStatusId = useId()
  const controlStatus =
    control?.phase === 'unknown'
      ? t(($) => $['taskControl.unknown'])
      : control?.phase === 'saving'
        ? t(($) => $['taskControl.saving'])
        : control
          ? control.operation === 'stop'
            ? t(($) => $['taskControl.stopping'])
            : t(($) => $['taskControl.resuming'])
          : operation === 'stop'
            ? t(($) => $['taskControl.running'])
            : operation === 'resume'
              ? canvasReady
                ? t(($) => $['taskControl.paused'])
                : t(($) => $['taskControl.syncing'])
              : null
  const descriptionId =
    [showStatus && statusId, controlStatus && controlStatusId].filter(Boolean).join(' ') ||
    undefined

  return (
    <>
      {showStatus && <DifyBuilderModelStatus {...modelState} id={statusId} rejected={rejected} />}
      {controlStatus && (
        <p id={controlStatusId} aria-live="polite" className="sr-only">
          {controlStatus}
        </p>
      )}
      <form
        aria-label={t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })}
        className="mx-4 overflow-hidden rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px] focus-within:border-components-input-border-active-prompt-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (!model) return
          void sendDraft(model)
        }}
      >
        <div className="flex flex-col items-end justify-end p-1.5">
          <DifyBuilderPromptInput descriptionId={descriptionId} />
          <div className="flex h-8 w-full shrink-0 items-center justify-between gap-2 ps-1">
            <DifyBuilderModelSelector {...modelState} />
            <DifyBuilderComposerAction
              hasModel={hasModel}
              descriptionId={controlStatus ? controlStatusId : undefined}
            />
          </div>
        </div>
      </form>
    </>
  )
}

export default DifyBuilderComposer
