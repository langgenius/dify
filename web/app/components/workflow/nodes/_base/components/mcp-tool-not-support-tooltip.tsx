'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'

const McpToolNotSupportTooltip: FC = () => {
  const { t } = useTranslation()
  return (
    <Tooltip
      popupContent={(
        <div className="w-[256px]">
          {t('detailPanel.toolSelector.unsupportedMCPTool', { ns: 'plugin' })}
        </div>
      )}
    >
      <span className="i-ri-alert-fill size-4 text-text-warning-secondary" />
    </Tooltip>
  )
}
export default React.memo(McpToolNotSupportTooltip)
