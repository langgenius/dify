'use client'
import type { WorkflowGeneratorMode } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiRefreshLine } from '@remixicon/react'
import { useSessionStorageState } from 'ahooks'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchWorkflowInstructionSuggestions } from '@/service/debug'

type Props = Readonly<{
  mode: WorkflowGeneratorMode
  onSelect: (prompt: string) => void
}>

const SUGGESTION_COUNT = 4
// Placeholder pill widths (px) while suggestions stream in — varied so the
// skeleton reads like a row of chips rather than a progress bar.
const SKELETON_WIDTHS = [88, 132, 104, 120]

// AbortController throws a DOMException in modern browsers and a plain Error in
// older / non-DOM environments — accept both so a user-triggered abort (modal
// close / regenerate) never surfaces as an error.
const isAbortError = (e: unknown): boolean =>
  (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError'

/**
 * "Ideas for you" chips under the instruction textarea.
 *
 * Primary content is AI-generated, workspace-grounded suggestions fetched when
 * the modal opens (cached per session per mode); a ↻ refresh pulls a fresh set.
 * When the backend can't generate (no default model, quota, parse failure) it
 * returns an empty list and we silently fall back to a curated static list, so
 * the row is never empty. Create-only — the parent hides it in refine mode.
 */
const ExamplePrompts = ({ mode, onSelect }: Props) => {
  const { t, i18n } = useTranslation('workflow')

  // Curated fallback, shown until AI suggestions arrive and whenever generation
  // is unavailable. The spread per mode covers a range of workflow shapes.
  const staticPrompts = useMemo(() => {
    if (mode === 'workflow') {
      return [
        t(($) => $['workflowGenerator.examples.workflow.summarize']),
        t(($) => $['workflowGenerator.examples.workflow.translate']),
        t(($) => $['workflowGenerator.examples.workflow.rag']),
        t(($) => $['workflowGenerator.examples.workflow.classify']),
      ]
    }
    return [
      t(($) => $['workflowGenerator.examples.chatflow.support']),
      t(($) => $['workflowGenerator.examples.chatflow.tutor']),
      t(($) => $['workflowGenerator.examples.chatflow.triage']),
    ]
  }, [mode, t])

  // Session-cached AI suggestions, keyed per mode so Workflow / Chatflow don't
  // clobber each other and a reopen within the same session skips the refetch.
  const [cached, setCached] = useSessionStorageState<string[]>(`workflow-gen-suggestions-${mode}`, {
    defaultValue: [],
  })
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const didInit = useRef(false)

  const fetchSuggestions = useCallback(async () => {
    abortRef.current?.abort()
    setIsLoading(true)
    try {
      const res = await fetchWorkflowInstructionSuggestions(
        { mode, language: i18n.language, count: SUGGESTION_COUNT },
        {
          getAbortController: (c) => {
            abortRef.current = c
          },
        },
      )
      const next = (res?.suggestions ?? []).map((s) => s.trim()).filter(Boolean)
      // Keep the previous set on an empty refresh so the row never flashes empty.
      if (next.length) setCached(next)
    } catch (e) {
      if (isAbortError(e)) return
      // Silent: the static fallback keeps the row populated.
    } finally {
      setIsLoading(false)
      abortRef.current = null
    }
  }, [mode, i18n.language, setCached])

  // Auto-fetch once on open when nothing is cached for this mode yet. ``mode``
  // is fixed per open (the modal remounts each time), so a mount-only effect is
  // correct here.
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    if (!cached || cached.length === 0) void fetchSuggestions()
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
    // oxlint-disable-next-line react/exhaustive-deps
  }, [mode])

  const aiPrompts = cached ?? []
  const prompts = aiPrompts.length ? aiPrompts : staticPrompts

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1">
        <span className="system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['workflowGenerator.examples.label'])}
        </span>
        <button
          type="button"
          data-testid="workflow-gen-suggestions-refresh"
          aria-label={t(($) => $['workflowGenerator.examples.refresh'])}
          title={t(($) => $['workflowGenerator.examples.refresh'])}
          className="flex size-4 cursor-pointer items-center justify-center rounded text-text-quaternary hover:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            void fetchSuggestions()
          }}
          disabled={isLoading}
        >
          <RiRefreshLine className={cn('size-3.5', isLoading && 'animate-spin')} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {isLoading
          ? SKELETON_WIDTHS.map((w, i) => (
              <div
                key={i}
                className="h-[26px] animate-pulse rounded-md bg-components-button-secondary-bg"
                style={{ width: w }}
              />
            ))
          : prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="cursor-pointer rounded-md border-[0.5px] border-divider-regular bg-components-button-secondary-bg px-2 py-1 system-xs-regular text-text-secondary hover:bg-components-button-secondary-bg-hover"
                onClick={() => onSelect(prompt)}
              >
                {prompt}
              </button>
            ))}
      </div>
    </div>
  )
}

export default memo(ExamplePrompts)
