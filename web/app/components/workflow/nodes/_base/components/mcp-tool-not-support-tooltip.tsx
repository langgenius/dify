'use client'
import type { FC } from 'react'
import type { MCPToolUnavailableReason } from './mcp-tool-availability'
import { RiAlertFill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  reason?: MCPToolUnavailableReason
}

const McpToolNotSupportTooltip: FC<Props> = ({ reason = 'version' }) => {
  const { t } = useTranslation()
  const getTooltipContent = () => {
    switch (reason) {
      case 'sandbox':
        return t('detailPanel.toolSelector.mcpToolSandboxOnly', { ns: 'plugin' })
      case 'both':
        return (
          <>
            <div>{t('detailPanel.toolSelector.unsupportedMCPTool', { ns: 'plugin' })}</div>
            <div className="mt-1">{t('detailPanel.toolSelector.mcpToolSandboxOnly', { ns: 'plugin' })}</div>
          </>
        )
      case 'version':
      default:
        return t('detailPanel.toolSelector.unsupportedMCPTool', { ns: 'plugin' })
    }
  }
  return (
    <Tooltip
      popupContent={(
        <div className="w-[256px]">
          {getTooltipContent()}
        </div>
      )}
    >
      <RiAlertFill className="size-4 text-text-warning-secondary" />
    </Tooltip>
  )
}
export default React.memo(McpToolNotSupportTooltip)
