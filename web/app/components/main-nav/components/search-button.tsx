'use client'

import { Kbd } from '@langgenius/dify-ui/kbd'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { useSetGotoAnythingOpen } from '@/app/components/goto-anything/atoms'

const searchShortcut = ['Mod', 'K']

export function MainNavSearchButton() {
  const { t } = useTranslation()
  const setGotoAnythingOpen = useSetGotoAnythingOpen()

  return (
    <button
      type="button"
      aria-label={t($ => $['gotoAnything.searchTitle'], { ns: 'app' })}
      className="flex h-8 items-center gap-1.5 overflow-hidden rounded-[10px] p-2 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      onClick={() => setGotoAnythingOpen(true)}
    >
      <span aria-hidden className="i-custom-vender-main-nav-quick-search h-4 w-4" />
      <Kbd className="h-4.5 min-w-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
        {searchShortcut.map(key => (
          <span key={key}>{formatForDisplay(key)}</span>
        ))}
      </Kbd>
    </button>
  )
}
