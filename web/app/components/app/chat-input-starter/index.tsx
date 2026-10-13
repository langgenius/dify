'use client'

import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { formatForDisplay, matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { memo, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TextareaAutosize from 'react-textarea-autosize'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { AgentBuildGridTexture } from '@/features/agent-v2/agent-detail/configure/components/build-grid-texture'
import { BuilderPromptModelGuide } from '../builder-prompt-model-guide'
import { CreateAppDialogShell } from '../create-app-dialog-shell'
import { useImproveBuilderPrompt } from '../use-improve-builder-prompt'
import { StarterTemplateEntry } from './template-entry'

const StarterGridTexture = memo(AgentBuildGridTexture)
const COMPOSITION_END_DELAY = 50
const DEFAULT_APP_KEYBINDINGS = {
  submitPrompt: 'Mod+Enter',
} satisfies Record<string, Hotkey>

export type StarterAppMode = Extract<CreateAppPayload['mode'], 'workflow' | 'advanced-chat'>

type ChatInputStarterProps = {
  show: boolean
  mode: StarterAppMode
  onClose: () => void
  onCreate: (prompt?: string) => void
  onCreateTemplate?: () => void
  isCreating: boolean
  disabled: boolean
  isAppsFull: boolean
  error: string
}

function StarterContent({
  mode,
  onCreate,
  isCreating,
  disabled,
  isAppsFull,
  error,
}: Omit<ChatInputStarterProps, 'show' | 'onClose' | 'onCreateTemplate'>) {
  const { t } = useTranslation(['app', 'workflow'])
  const [prompt, setPrompt] = useState('')
  const {
    improve,
    isPending,
    error: optimizeError,
    notice: optimizeNotice,
    resetFeedback,
    ...modelState
  } = useImproveBuilderPrompt(mode, setPrompt)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleId = useId()
  const errorId = useId()
  const errorMessage = error || optimizeError
  const feedbackMessage = errorMessage || optimizeNotice
  const suggestions = [
    { label: t(($) => $['newApp.starter.invoices'], { ns: 'app' }), icon: 'i-ri-table-line' },
    { label: t(($) => $['newApp.starter.tickets'], { ns: 'app' }), icon: 'i-ri-file-list-2-line' },
    { label: t(($) => $['newApp.starter.translate'], { ns: 'app' }), icon: 'i-ri-translate-2' },
  ]

  useEffect(
    () => () => {
      if (compositionEndTimerRef.current) clearTimeout(compositionEndTimerRef.current)
    },
    [],
  )

  return (
    <div className="flex min-h-128 flex-1 items-center justify-center px-4 pt-16 pb-22 sm:px-8">
      <div className="w-160 max-w-full">
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The native form owns the submit shortcut shared by its controls. */}
        <form
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (
              disabled ||
              isCreating ||
              !prompt.trim() ||
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              isComposingRef.current ||
              !(event.target instanceof Node) ||
              !event.currentTarget.contains(event.target) ||
              !matchesKeyboardEvent(event.nativeEvent, DEFAULT_APP_KEYBINDINGS.submitPrompt)
            )
              return
            event.preventDefault()
            event.stopPropagation()
            if (event.repeat) return
            event.currentTarget.requestSubmit()
          }}
          onSubmit={(event) => {
            event.preventDefault()
            if (prompt.trim() && !disabled && !isCreating) {
              resetFeedback()
              onCreate(prompt.trim())
            }
          }}
        >
          <div className="mb-6 flex items-center justify-center gap-2">
            <h2
              id={titleId}
              className="text-center text-2xl leading-tight font-medium text-text-primary sm:text-[32px]"
            >
              {mode === 'workflow'
                ? t(($) => $['newApp.starter.workflowTitle'], { ns: 'app' })
                : t(($) => $['newApp.starter.chatflowTitle'], { ns: 'app' })}
            </h2>
            <span
              aria-hidden
              className="i-custom-public-app-builder-builder-mark size-7.5 shrink-0"
            />
          </div>
          <div className="group overflow-hidden rounded-[14px] bg-background-section-burn p-1 focus-within:bg-state-accent-active">
            {/* Keep the frame above the toolbar background so its border stays continuous. */}
            <div
              className={cn(
                'relative overflow-hidden rounded-xl bg-components-panel-bg-blur shadow-[0_4px_6px_-2px_var(--color-shadow-shadow-1),0_12px_16px_-4px_var(--color-shadow-shadow-5)] backdrop-blur-[5px]',
                "after:pointer-events-none after:absolute after:inset-0 after:z-1 after:rounded-xl after:border after:border-transparent after:content-[''] group-focus-within:after:border-text-accent/15",
              )}
            >
              <TextareaAutosize
                ref={inputRef}
                name="prompt"
                aria-labelledby={titleId}
                aria-describedby={feedbackMessage ? errorId : undefined}
                aria-invalid={!!error}
                placeholder={t(($) => $['newApp.starter.placeholder'], { ns: 'app' })}
                value={prompt}
                onChange={(event) => {
                  resetFeedback()
                  setPrompt(event.currentTarget.value)
                }}
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
                disabled={isCreating}
                minRows={4}
                maxRows={16}
                className="block min-h-26 w-full resize-none overflow-y-auto overscroll-contain border-0 bg-transparent p-3 body-md-regular tracking-[-0.07px] text-text-secondary caret-text-accent outline-hidden placeholder:text-text-placeholder"
              />
              <div className="flex h-12 shrink-0 items-center justify-between gap-2 bg-background-section p-2">
                {/* The Chat Input design uses 6px padding around the icon and 3px around the label. */}
                <BuilderPromptModelGuide {...modelState}>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost-accent"
                    className="gap-px px-1.5 leading-4"
                    disabled={
                      disabled || isCreating || !prompt.trim() || modelState.modelStatus !== 'ready'
                    }
                    focusableWhenDisabled={modelState.modelStatus !== 'ready' || isPending}
                    loading={isPending}
                    aria-describedby={optimizeError || optimizeNotice ? errorId : undefined}
                    onClick={() => improve(prompt)}
                  >
                    <span aria-hidden className="i-ri-sparkling-fill size-3.5" />
                    <span className="px-0.75">
                      {t(($) => $['newApp.optimizeWithAI'], { ns: 'app' })}
                    </span>
                  </Button>
                </BuilderPromptModelGuide>
                <div className="flex shrink-0 items-center gap-3">
                  <KbdGroup className="hidden sm:inline-flex">
                    {formatForDisplay(DEFAULT_APP_KEYBINDINGS.submitPrompt, { parts: true }).map(
                      (key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ),
                    )}
                  </KbdGroup>
                  <IconButton
                    type="submit"
                    variant="primary"
                    size="lg"
                    aria-label={t(($) => $['difyBuilder.messageSend'], { ns: 'workflow' })}
                    disabled={disabled || isCreating || !prompt.trim()}
                  >
                    <span
                      aria-hidden
                      className={
                        isCreating
                          ? 'i-ri-loader-4-line size-4 animate-spin'
                          : 'i-ri-send-plane-2-fill size-4'
                      }
                    />
                  </IconButton>
                </div>
              </div>
            </div>
          </div>
          {feedbackMessage && (
            <p
              id={errorId}
              role={errorMessage ? 'alert' : 'status'}
              className={cn(
                'mt-2 system-sm-regular',
                errorMessage ? 'text-text-destructive' : 'text-text-tertiary',
              )}
            >
              {feedbackMessage}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {suggestions.map(({ label, icon }) => (
              <Button
                key={icon}
                variant="tertiary"
                disabled={isCreating}
                className="rounded-full"
                onClick={() => {
                  resetFeedback()
                  setPrompt(label)
                  inputRef.current?.focus()
                }}
              >
                <span aria-hidden className={cn(icon, 'size-4 text-text-tertiary')} />
                {label}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            disabled={disabled}
            loading={isCreating}
            className="mx-auto mt-9 flex h-10 w-141.25 max-w-full border border-dashed border-components-panel-border-subtle text-text-tertiary"
            onClick={() => {
              resetFeedback()
              onCreate()
            }}
          >
            <span aria-hidden className="i-ri-add-line size-4 text-text-quaternary" />
            {t(($) => $['newApp.starter.openBlank'], { ns: 'app' })}
          </Button>
        </form>
        {isAppsFull && <AppsFull className="mt-4" loc="app-create" />}
      </div>
    </div>
  )
}

export default function ChatInputStarter({
  show,
  onClose,
  onCreateTemplate,
  ...props
}: ChatInputStarterProps) {
  const { t } = useTranslation(['app'])
  return (
    <CreateAppDialogShell
      show={show}
      onClose={onClose}
      title={
        props.mode === 'workflow'
          ? t(($) => $['newApp.starter.workflowTitle'], { ns: 'app' })
          : t(($) => $['newApp.starter.chatflowTitle'], { ns: 'app' })
      }
    >
      <StarterGridTexture
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 select-none"
      />
      <div className="relative flex h-full flex-col overflow-x-hidden overflow-y-auto">
        <StarterContent key={props.mode} {...props} />
        {onCreateTemplate && (
          <StarterTemplateEntry disabled={props.isCreating} onClick={onCreateTemplate} />
        )}
      </div>
    </CreateAppDialogShell>
  )
}
