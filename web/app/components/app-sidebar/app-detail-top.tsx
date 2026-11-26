'use client'

import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { useStudioListHref } from '@/app/components/apps/list-navigation-state'
import { DetailSidebarToggleButton } from '@/app/components/detail-sidebar/toggle-button'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/handles'
import { GOTO_ANYTHING_HOTKEY } from '@/app/components/goto-anything/hotkeys'
import Link from '@/next/link'

type AppDetailTopProps = {
  expand?: boolean
  onToggle?: () => void
}

export function AppDetailTop({ expand = true, onToggle }: AppDetailTopProps) {
  const { t } = useTranslation(['app', 'navigation'])
  const appsHref = useStudioListHref('/apps')

  if (!expand) {
    return (
      <div className="flex w-full items-center justify-center px-3 pt-2 pb-1">
        {onToggle && (
          <DetailSidebarToggleButton
            expand={expand}
            onToggle={onToggle}
            icon={
              <span aria-hidden className="i-custom-vender-line-arrows-sidebar-left-arrow size-4" />
            }
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center p-2">
      <Link
        href={appsHref}
        className="me-auto inline-flex h-8 min-w-18.5 items-center rounded-lg py-2 ps-0.5 pe-1.5 system-sm-semibold-uppercase whitespace-nowrap text-text-secondary transition-colors hover:bg-background-default-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <span
          aria-hidden
          className="i-ri-arrow-left-s-line size-4 shrink-0 text-text-tertiary rtl:rotate-180"
        />
        {t(($) => $['menus.apps'], { ns: 'navigation' })}
      </Link>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              handle={gotoAnythingDialogHandle}
              render={
                <button
                  type="button"
                  aria-label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
                  className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
                >
                  <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
                </button>
              }
            />
          }
        />
        <TooltipContent side="bottom" className="flex items-center gap-1">
          <span className="px-0.5">{t(($) => $['gotoAnything.quickAction'], { ns: 'app' })}</span>
          <KbdGroup>
            {formatForDisplay(GOTO_ANYTHING_HOTKEY, { parts: true }).map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
      {onToggle && (
        <DetailSidebarToggleButton
          expand={expand}
          onToggle={onToggle}
          icon={
            <span aria-hidden className="i-custom-vender-line-arrows-sidebar-left-arrow size-4" />
          }
        />
      )}
    </div>
  )
}
