'use client'

import { useTranslation } from 'react-i18next'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'

const AppDetailTop = () => {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <div className="flex items-center py-3 pr-3 pl-1">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <div className="flex shrink-0 items-center py-1 pr-1 pl-0.5">
          <button
            type="button"
            aria-label={t('operation.back', { ns: 'common' })}
            className="flex size-4 items-center justify-center text-text-tertiary hover:text-text-secondary"
            onClick={() => router.back()}
          >
            <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
          </button>
          <Link
            href="/"
            aria-label={t('mainNav.home', { ns: 'common' })}
            className="flex size-4 items-center justify-center text-text-tertiary hover:text-text-secondary"
          >
            <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
          </Link>
        </div>
        <span className="mx-1.5 shrink-0 system-md-regular text-text-quaternary">
          /
        </span>
        <Link
          href="/apps"
          className="shrink-0 truncate system-sm-semibold-uppercase text-text-secondary hover:text-text-primary"
        >
          {t('menus.apps', { ns: 'common' })}
        </Link>
      </div>
      <button
        type="button"
        aria-label={t('gotoAnything.searchTitle', { ns: 'app' })}
        className="flex shrink-0 items-center gap-1 overflow-hidden rounded-[10px] p-1 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
        onClick={() => window.dispatchEvent(new Event(GOTO_ANYTHING_OPEN_EVENT))}
      >
        <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
        <span className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
          ⌘K
        </span>
      </button>
    </div>
  )
}

export default AppDetailTop
