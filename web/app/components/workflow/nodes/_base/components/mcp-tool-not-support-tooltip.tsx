'use client'
import type { FC } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiAlertFill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const McpToolNotSupportTooltip: FC = () => {
  const { t } = useTranslation()
  const tip = t('detailPanel.toolSelector.unsupportedMCPTool', { ns: 'plugin' })

  return (
    <Popover>
      <PopoverTrigger openOnHover aria-label={tip} className="inline-flex border-0 bg-transparent p-0">
        <RiAlertFill className="size-4 text-text-warning-secondary" />
      </PopoverTrigger>
      <PopoverContent popupClassName="w-[256px] px-3 py-2 system-xs-regular text-text-tertiary">
        {tip}
      </PopoverContent>
    </Popover>
  )
}
export default React.memo(McpToolNotSupportTooltip)
