'use client'

import { useTranslation } from 'react-i18next'

type SnippetHeaderProps = {
  inputFieldCount: number
  onToggleInputPanel: () => void
  onTogglePublishMenu: () => void
}

const SnippetHeader = ({
  inputFieldCount,
  onToggleInputPanel,
  onTogglePublishMenu,
}: SnippetHeaderProps) => {
  const { t } = useTranslation('snippet')

  return (
    <div className="absolute right-3 top-3 z-20 flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 text-text-secondary shadow-xs backdrop-blur"
        onClick={onToggleInputPanel}
      >
        <span className="text-[13px] font-medium leading-4">{t('inputFieldButton')}</span>
        <span className="rounded-md border border-divider-deep px-1.5 py-0.5 text-[10px] font-medium leading-3 text-text-tertiary">
          {inputFieldCount}
        </span>
      </button>

      <button
        type="button"
        className="flex items-center gap-2 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 text-text-accent shadow-xs backdrop-blur"
      >
        <span aria-hidden className="i-ri-play-mini-fill h-4 w-4" />
        <span className="text-[13px] font-medium leading-4">{t('testRunButton')}</span>
        <span className="rounded-md bg-state-accent-active px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-text-accent">R</span>
      </button>

      <div className="relative">
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg bg-components-button-primary-bg px-3 py-2 text-white shadow-[0px_2px_2px_-1px_rgba(0,0,0,0.12),0px_1px_1px_-1px_rgba(0,0,0,0.12),0px_0px_0px_0.5px_rgba(9,9,11,0.05)]"
          onClick={onTogglePublishMenu}
        >
          <span className="text-[13px] font-medium leading-4">{t('publishButton')}</span>
          <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg text-text-tertiary shadow-xs"
      >
        <span aria-hidden className="i-ri-more-2-line h-4 w-4" />
      </button>
    </div>
  )
}

export default SnippetHeader
