'use client'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@langgenius/dify-ui/breadcrumb'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import SidebarLeftArrowIcon from '@/app/components/base/icons/src/vender/SidebarLeftArrowIcon'
import { DetailSidebarToggleButton } from '@/app/components/detail-sidebar/toggle-button'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import { GOTO_ANYTHING_HOTKEY } from '@/app/components/goto-anything/hotkeys'
import Link from '@/next/link'

type DatasetDetailTopProps = {
  expand?: boolean
  onToggle?: () => void
}

export function DatasetDetailTop({ expand = true, onToggle }: DatasetDetailTopProps) {
  const { t } = useTranslation()

  if (!expand) {
    return (
      <div className="flex w-full items-center justify-center px-3 pt-2 pb-1">
        {onToggle && (
          <DetailSidebarToggleButton
            expand={expand}
            onToggle={onToggle}
            icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center py-2 pr-2 pl-1">
      <Breadcrumb aria-label={t(($) => $['menus.datasets'], { ns: 'common' })} className="flex-1">
        <BreadcrumbList className="gap-px">
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink
              render={<Link href="/" />}
              aria-label={t(($) => $['mainNav.home'], { ns: 'common' })}
              className="gap-0 rounded-lg py-2 pr-1.5 pl-0.5 hover:bg-background-default-hover"
            >
              <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
              <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
            </BreadcrumbLink>
          </BreadcrumbItem>
          {expand && (
            <>
              <BreadcrumbSeparator className="system-md-regular" />
              <BreadcrumbItem className="shrink-0">
                <BreadcrumbLink
                  render={<Link href="/datasets" />}
                  className="rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary hover:bg-background-default-hover hover:text-text-primary"
                >
                  {t(($) => $['menus.datasets'], { ns: 'common' })}
                </BreadcrumbLink>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      {expand && (
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                handle={gotoAnythingDialogHandle}
                render={
                  <button
                    type="button"
                    aria-label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
                    className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  >
                    <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
                  </button>
                }
              />
            }
          />
          <TooltipContent placement="bottom" className="flex items-center gap-1">
            <span className="px-0.5">{t(($) => $['gotoAnything.quickAction'], { ns: 'app' })}</span>
            <KbdGroup>
              {GOTO_ANYTHING_HOTKEY.split('+').map((key) => (
                <Kbd key={key}>{formatForDisplay(key)}</Kbd>
              ))}
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
      )}
      {onToggle && (
        <DetailSidebarToggleButton
          expand={expand}
          onToggle={onToggle}
          icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
        />
      )}
    </div>
  )
}
