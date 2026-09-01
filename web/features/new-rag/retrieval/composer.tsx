'use client'

import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { RetrievalModeSegmentedControl } from '../components/retrieval-mode-segmented-control'
import {
  retrievalComposerFactsAtom,
  updateRetrievalComposerModeAtom,
  updateRetrievalComposerQueryAtom,
} from './state/graph'
import { runRetrievalAtom } from './state/runtime'

const runRetrievalHotkey = 'Mod+Enter' satisfies Hotkey

export function RetrievalComposer() {
  const { t } = useTranslation('dataset')
  const { disabled, mode, query, runnable } = useAtomValue(retrievalComposerFactsAtom)
  const updateQuery = useSetAtom(updateRetrievalComposerQueryAtom)
  const updateMode = useSetAtom(updateRetrievalComposerModeAtom)
  const run = useSetAtom(runRetrievalAtom)

  return (
    <div className="shrink-0">
      <div className="overflow-hidden rounded-xl bg-components-panel-bg shadow-xs inset-ring-2 inset-ring-components-input-border-active-prompt-2">
        <label className="sr-only" htmlFor="retrieval-test-query">
          {t(($) => $['newKnowledge.retrievalTest.queryPlaceholder'])}
        </label>
        <textarea
          id="retrieval-test-query"
          value={query}
          maxLength={2000}
          disabled={disabled}
          placeholder={t(($) => $['newKnowledge.retrievalTest.queryPlaceholder'])}
          className="block h-36 w-full resize-none bg-transparent p-3.5 body-md-regular text-text-primary outline-hidden placeholder:text-text-quaternary"
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={(event) => {
            if (matchesKeyboardEvent(event.nativeEvent, runRetrievalHotkey)) {
              event.preventDefault()
              run()
            }
          }}
        />
        <div className="flex min-h-13 items-center justify-between gap-3 p-2.5">
          <RetrievalModeSegmentedControl
            aria-label={t(($) => $['newKnowledge.settings.retrievalModeLabel'])}
            appearance="composer"
            disabled={disabled}
            value={mode}
            onChange={updateMode}
          />
          <Button variant="primary" className="px-3.25" disabled={!runnable} onClick={run}>
            <span aria-hidden className="i-ri-play-circle-line size-4" />
            {t(($) =>
              mode === 'research'
                ? $['newKnowledge.retrievalTest.startResearch']
                : $['newKnowledge.retrievalTest.run'],
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
