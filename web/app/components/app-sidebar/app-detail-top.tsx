'use client'

import { useTranslation } from 'react-i18next'
import { useSetGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import ToggleButton from './toggle-button'

type AppDetailTopProps = {
  expand?: boolean
  onToggle?: () => void
}

const AppDetailTop = ({
  expand = true,
  onToggle,
}: AppDetailTopProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const setGotoAnythingOpen = useSetGotoAnythingOpen()

  return (
    <div className="flex items-center py-2 pr-2 pl-1">
      <div className="flex min-w-0 flex-1 items-center gap-px">
        <div className="flex shrink-0 items-center py-2 pr-1.5 pl-0.5">
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
        {expand && (
          <>
            <span className="shrink-0 system-md-regular text-text-quaternary">
              /
            </span>
            <Link
              href="/apps"
              className="shrink-0 truncate rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary hover:bg-state-base-hover hover:text-text-primary"
            >
              {t('menus.apps', { ns: 'common' })}
            </Link>
          </>
        )}
      </div>
      {expand && (
        <button
          type="button"
          aria-label={t('gotoAnything.searchTitle', { ns: 'app' })}
          className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={() => setGotoAnythingOpen(true)}
        >
          <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
        </button>
      )}
      {onToggle && (
        <ToggleButton
          expand={expand}
          handleToggle={onToggle}
          iconClassName="i-custom-vender-integrations-panel-left"
          className="size-8 rounded-[10px] px-0 text-text-tertiary shadow-none hover:bg-state-base-hover hover:text-text-secondary"
        />
      )}
    </div>
  )
}

export default AppDetailTop
