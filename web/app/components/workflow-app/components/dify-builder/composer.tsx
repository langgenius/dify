import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import DifyBuilderModelSelector from './model-selector'
import {
  difyBuilderCanComposeAtom,
  difyBuilderCanSendDraftAtom,
  difyBuilderDraftAtom,
  difyBuilderSendDraftAtom,
} from './store'

const COMPOSITION_END_DELAY = 50

const DifyBuilderPromptInput = () => {
  const { t } = useTranslation()
  const [draft, setDraft] = useAtom(difyBuilderDraftAtom)
  const canCompose = useAtomValue(difyBuilderCanComposeAtom)
  const sendDraft = useSetAtom(difyBuilderSendDraftAtom)
  const isComposingRef = useRef(false)
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (compositionEndTimerRef.current) clearTimeout(compositionEndTimerRef.current)
    }
  }, [])

  return (
    <textarea
      value={draft}
      disabled={!canCompose}
      aria-label={t(($) => $['difyBuilder.messagePlaceholder'], { ns: 'workflow' })}
      placeholder={
        canCompose
          ? t(($) => $['difyBuilder.messagePlaceholder'], { ns: 'workflow' })
          : t(($) => $['difyBuilder.useActions'], { ns: 'workflow' })
      }
      className="block min-h-10 w-full grow resize-none bg-transparent px-2 py-1 text-sm leading-5 tracking-[-0.07px] text-text-primary caret-[#295EFF] outline-hidden placeholder:text-text-placeholder disabled:cursor-not-allowed"
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
        void sendDraft()
      }}
    />
  )
}

const DifyBuilderSendButton = () => {
  const { t } = useTranslation()
  const canSend = useAtomValue(difyBuilderCanSendDraftAtom)
  const sendDraft = useSetAtom(difyBuilderSendDraftAtom)

  return (
    <button
      type="button"
      disabled={!canSend}
      aria-label={t(($) => $['difyBuilder.messageSend'], { ns: 'workflow' })}
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border-[0.5px] border-components-button-primary-border bg-components-button-primary-bg text-components-button-primary-text outline-hidden hover:border-components-button-primary-border-hover hover:bg-components-button-primary-bg-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:border-components-button-primary-border-disabled disabled:bg-components-button-primary-bg-disabled disabled:text-components-button-primary-text-disabled"
      onClick={() => void sendDraft()}
    >
      <span aria-hidden className="i-ri-send-plane-2-fill size-4" />
    </button>
  )
}

const DifyBuilderComposer = () => {
  return (
    <div className="mx-4 h-21 overflow-hidden rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px] focus-within:border-components-input-border-active-prompt-1">
      <div className="flex h-full flex-col items-end justify-end p-1.5">
        <DifyBuilderPromptInput />
        <div className="flex h-8 w-full shrink-0 items-center justify-between gap-2 pl-1">
          <DifyBuilderModelSelector />
          <DifyBuilderSendButton />
        </div>
      </div>
    </div>
  )
}

export default DifyBuilderComposer
