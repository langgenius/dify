'use client'

/**
 * AI-assisted page generator (isolated feature).
 *
 * Self-contained console page that streams a natural-language description to
 * the `/console/api/page-generate` backend endpoint and renders the returned
 * HTML into a live iframe preview.
 *
 * Isolation notes:
 * - This route is added purely by file placement under `(commonLayout)`, so it
 *   inherits login-gating without touching any existing file.
 * - It reuses the shared `ssePost` streaming client from `@/service/base`; the
 *   backend emits the same `event: 'message' | 'message_end' | 'error'` SSE
 *   envelope that `handleStream` already understands.
 * - All copy is local to this experimental page; it is intentionally kept out
 *   of the shared i18n bundle to avoid modifying existing locale files.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { generatePage } from './service'

const MAX_DESCRIPTION_LENGTH = 4000

const EXAMPLES = [
  'A modern SaaS landing page for an AI note-taking app, hero + features + pricing.',
  'A personal portfolio homepage for a product designer with a projects grid.',
  'A restaurant menu page with sections for starters, mains and desserts.',
]

const PageGenerator = () => {
  const [description, setDescription] = useState('')
  const [html, setHtml] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const htmlRef = useRef('')

  const canGenerate = description.trim().length > 0 && !isGenerating

  const handleGenerate = useCallback(() => {
    if (description.trim().length === 0 || isGenerating)
      return

    setIsGenerating(true)
    setError('')
    setHtml('')
    htmlRef.current = ''

    generatePage(description.trim(), {
      onData: (message: string) => {
        htmlRef.current += message
        setHtml(htmlRef.current)
      },
      onCompleted: (hasError?: boolean, errorMessage?: string) => {
        setIsGenerating(false)
        if (hasError)
          setError(errorMessage || 'Generation failed')
      },
      onError: (msg: string) => {
        setIsGenerating(false)
        setError(msg || 'Generation failed')
      },
    })
  }, [description, isGenerating])

  // Strip accidental markdown fences so the iframe always gets clean HTML,
  // even if the model wraps the document in ```html ... ```.
  const previewDoc = useMemo(() => {
    const trimmed = html.trim()
    if (trimmed.startsWith('```')) {
      return trimmed
        .replace(/^```(?:html)?\s*/i, '')
        .replace(/```\s*$/, '')
    }
    return trimmed
  }, [html])

  return (
    <div className="flex h-full w-full flex-col bg-background-body">
      <header className="flex items-center justify-between border-b border-divider-subtle px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">AI Page Generator</h1>
          <p className="text-xs text-text-tertiary">
            Describe a page in natural language — the default LLM streams a live HTML preview.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: prompt input */}
        <div className="flex w-[380px] shrink-0 flex-col gap-3 border-r border-divider-subtle p-6">
          <label className="text-sm font-medium text-text-secondary" htmlFor="page-desc">
            Page description
          </label>
          <textarea
            id="page-desc"
            className="min-h-[160px] flex-1 resize-none rounded-lg border border-divider-regular bg-components-input-bg-normal p-3 text-sm text-text-primary outline-none focus:border-components-input-border-active"
            placeholder="e.g. A modern landing page for a coffee subscription service…"
            value={description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onChange={e => setDescription(e.target.value)}
            disabled={isGenerating}
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                type="button"
                className="rounded-md border border-divider-regular px-2 py-1 text-left text-xs text-text-tertiary hover:bg-state-base-hover"
                onClick={() => setDescription(ex)}
                disabled={isGenerating}
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mt-1 rounded-lg bg-components-button-primary-bg px-4 py-2 text-sm font-medium text-components-button-primary-text disabled:opacity-50"
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {isGenerating ? 'Generating…' : 'Generate page'}
          </button>
          {error && (
            <p className="rounded-md bg-components-input-bg-normal p-2 text-xs text-text-destructive">{error}</p>
          )}
          <p className="text-[11px] text-text-quaternary">
            Uses your workspace default LLM. Configure it in Settings → Model Provider if generation fails.
          </p>
        </div>

        {/* Right: live preview */}
        <div className="flex min-w-0 flex-1 flex-col p-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-text-secondary">Live preview</span>
            {isGenerating && <span className="text-xs text-text-tertiary">streaming…</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-divider-regular bg-white">
            {previewDoc
              ? (
                  <iframe
                    title="page-preview"
                    className="h-full w-full"
                    sandbox="allow-scripts"
                    srcDoc={previewDoc}
                  />
                )
              : (
                  <div className="flex h-full items-center justify-center text-sm text-text-quaternary">
                    Your generated page will appear here.
                  </div>
                )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(PageGenerator)
