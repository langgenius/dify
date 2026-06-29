'use client'

import { SnippetPlaceholderIcon } from './snippet-placeholder-icon'

export function SnippetCollapsedPreview({
  inputFieldCount,
}: {
  inputFieldCount: number
}) {
  return (
    <div
      className="flex min-h-0 grow flex-col items-center px-2 pt-4"
      aria-label="Snippet collapsed preview"
    >
      <SnippetPlaceholderIcon />
      <div className="my-4 h-px w-8 rounded-full bg-divider-subtle" aria-hidden="true" />
      <div
        className="relative flex size-8 items-center justify-center rounded-lg border border-divider-subtle bg-background-default-subtle text-text-accent shadow-xs"
        aria-label={`${inputFieldCount} input fields`}
      >
        <span aria-hidden="true" className="i-custom-vender-solid-development-variable-02 size-5" />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-4 items-center justify-center rounded-full border-2 border-components-panel-bg bg-state-accent-solid text-2xs leading-none text-text-primary-on-surface shadow-xs">
          {inputFieldCount}
        </span>
      </div>
    </div>
  )
}
