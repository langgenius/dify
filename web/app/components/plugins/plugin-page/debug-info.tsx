'use client'
import type { FC } from 'react'
import {
  RiArrowRightUpLine,
  RiBugLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { useDocLink } from '@/context/i18n'
import { useDebugKey } from '@/service/use-plugins'
import KeyValueItem from '../base/key-value-item'

const i18nPrefix = 'debugInfo'

const DebugInfo: FC = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: info, isLoading } = useDebugKey()

  // info.key likes 4580bdb7-b878-471c-a8a4-bfd760263a53 mask the middle part using *.
  const maskedKey = info?.key?.replace(/(.{8})(.*)(.{8})/, '$1********$3')

  if (isLoading)
    return null

  return (
    <Tooltip
      triggerMethod="click"
      disabled={!info}
      popupContent={(
        <>
          <div className="flex items-center gap-1 self-stretch">
            <span className="system-sm-semibold flex shrink-0 grow basis-0 flex-col items-start justify-center text-text-secondary">{t(`${i18nPrefix}.title`, { ns: 'plugin' })}</span>
            <a href={docLink('/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin')} target="_blank" className="flex cursor-pointer items-center gap-0.5 text-text-accent-light-mode-only">
              <span className="system-xs-medium">{t(`${i18nPrefix}.viewDocs`, { ns: 'plugin' })}</span>
              <RiArrowRightUpLine className="h-3 w-3" />
            </a>
          </div>
          <div className="space-y-0.5">
            <KeyValueItem
              label="URL"
              value={`${info?.host}:${info?.port}`}
            />
            <KeyValueItem
              label="Key"
              value={info?.key || ''}
              maskedValue={maskedKey}
            />
          </div>
        </>
      )}
      popupClassName="flex flex-col items-start w-[256px] px-4 py-3.5 gap-1 border border-components-panel-border
        rounded-xl bg-components-tooltip-bg shadows-shadow-lg z-50"
      asChild={false}
      position="bottom"
    >
      <Button className="h-full w-full p-2 text-components-button-secondary-text">
        <RiBugLine className="h-4 w-4" />
      </Button>
    </Tooltip>
  )
}

export default React.memo(DebugInfo)
