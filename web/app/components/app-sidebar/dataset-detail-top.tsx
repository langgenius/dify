'use client'

import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import SidebarLeftArrowIcon from '@/app/components/base/icons/src/vender/SidebarLeftArrowIcon'
import { useSetGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import Link from '@/next/link'
import ToggleButton from './toggle-button'

type DatasetDetailTopProps = {
  expand?: boolean
  onToggle?: () => void
}

const SEARCH_SHORTCUT = ['Mod', 'K']

const DatasetDetailTop = ({ expand = true, onToggle }: DatasetDetailTopProps) => {
  const { t } = useTranslation()
  const setGotoAnythingOpen = useSetGotoAnythingOpen()

  if (!expand) {
    return (
      <div className="flex w-full items-center justify-center px-3 pt-2 pb-1">
        {onToggle && (
          <ToggleButton
            expand={expand}
            handleToggle={onToggle}
            icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
            className="size-8 rounded-[10px] border-0 bg-transparent px-0 text-text-tertiary shadow-none hover:border-0 hover:bg-state-base-hover hover:text-text-secondary"
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center py-2 pr-2 pl-1">
      <div className="flex min-w-0 flex-1 items-center gap-px">
        <Link
          href="/"
          aria-label={t(($) => $['mainNav.home'], { ns: 'common' })}
          className="flex shrink-0 items-center rounded-lg py-2 pr-1.5 pl-0.5 text-text-tertiary transition-colors hover:bg-background-default-hover hover:text-text-secondary"
        >
          <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
          <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
        </Link>
        {expand && (
          <>
            <span className="shrink-0 system-md-regular text-text-quaternary">/</span>
            <Link
              href="/datasets"
              className="shrink-0 truncate rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary transition-colors hover:bg-background-default-hover hover:text-text-primary"
            >
              {t(($) => $['menus.datasets'], { ns: 'common' })}
            </Link>
          </>
        )}
      </div>
      {expand && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
                className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
                onClick={() => setGotoAnythingOpen(true)}
              >
                <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
              </button>
            }
          />
          <TooltipContent
            placement="bottom"
            className="flex items-center gap-1 rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 system-xs-medium text-text-secondary shadow-lg backdrop-blur-[5px]"
          >
            <span className="px-0.5">{t(($) => $['gotoAnything.quickAction'], { ns: 'app' })}</span>
            <KbdGroup>
              {SEARCH_SHORTCUT.map((key) => (
                <Kbd key={key}>{formatForDisplay(key)}</Kbd>
              ))}
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
      )}
      {onToggle && (
        <ToggleButton
          expand={expand}
          handleToggle={onToggle}
          icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
          className="size-8 rounded-[10px] border-0 bg-transparent px-0 text-text-tertiary shadow-none hover:border-0 hover:bg-state-base-hover hover:text-text-secondary"
        />
      )}
    </div>
  )
}

export default DatasetDetailTop
