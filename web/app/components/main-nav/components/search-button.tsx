'use client'

import { useTranslation } from 'react-i18next'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'

const MainNavSearchButton = () => {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      aria-label={t('gotoAnything.searchTitle', { ns: 'app' })}
      className="flex h-8 items-center gap-1.5 overflow-hidden rounded-[10px] p-2 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
      onClick={() => window.dispatchEvent(new Event(GOTO_ANYTHING_OPEN_EVENT))}
    >
      <span aria-hidden className="i-custom-vender-main-nav-quick-search h-4 w-4" />
      <span className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">⌘K</span>
    </button>
  )
}

export default MainNavSearchButton
