'use client'

import {
  RiCheckLine,
  RiComputerLine,
  RiMoonLine,
  RiSunLine,
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type Theme = 'light' | 'dark' | 'system'

export default function ThemeSelector() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
    setOpen(false)
  }

  const getCurrentIcon = () => {
    switch (theme) {
      case 'light': return <RiSunLine className="h-4 w-4 text-text-tertiary" />
      case 'dark': return <RiMoonLine className="h-4 w-4 text-text-tertiary" />
      default: return <RiComputerLine className="h-4 w-4 text-text-tertiary" />
    }
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{ mainAxis: 6 }}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(!open)}
      >
        <ActionButton
          className={`h-8 w-8 p-[6px] ${open && 'bg-state-base-hover'}`}
        >
          {getCurrentIcon()}
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="flex w-[144px] flex-col items-start rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-text-secondary hover:bg-state-base-hover"
            onClick={() => handleThemeChange('light')}
          >
            <RiSunLine className="h-4 w-4 text-text-tertiary" />
            <div className="flex grow items-center justify-start px-1">
              <span className="system-md-regular">{t('theme.light', { ns: 'common' })}</span>
            </div>
            {theme === 'light' && (
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                <RiCheckLine className="h-4 w-4 text-text-accent" />
              </div>
            )}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-text-secondary hover:bg-state-base-hover"
            onClick={() => handleThemeChange('dark')}
          >
            <RiMoonLine className="h-4 w-4 text-text-tertiary" />
            <div className="flex grow items-center justify-start px-1">
              <span className="system-md-regular">{t('theme.dark', { ns: 'common' })}</span>
            </div>
            {theme === 'dark' && (
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                <RiCheckLine className="h-4 w-4 text-text-accent" />
              </div>
            )}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-text-secondary hover:bg-state-base-hover"
            onClick={() => handleThemeChange('system')}
          >
            <RiComputerLine className="h-4 w-4 text-text-tertiary" />
            <div className="flex grow items-center justify-start px-1">
              <span className="system-md-regular">{t('theme.auto', { ns: 'common' })}</span>
            </div>
            {theme === 'system' && (
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                <RiCheckLine className="h-4 w-4 text-text-accent" />
              </div>
            )}
          </button>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
