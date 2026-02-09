'use client'
import type { FC } from 'react'
import { RiAlertFill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useMCPToolAvailability } from './mcp-tool-availability'

const McpToolNotSupportTooltip: FC = () => {
  const { t } = useTranslation()
  const { blockedBy } = useMCPToolAvailability()
  const messageKey = blockedBy === 'sandbox'
    ? 'detailPanel.toolSelector.mcpToolSandboxOnly'
    : 'detailPanel.toolSelector.unsupportedMCPTool'
  return (
    <Tooltip
      popupContent={(
        <div className="w-[256px]">
          {t(messageKey, { ns: 'plugin' })}
        </div>
      )}
    >
      <RiAlertFill className="size-4 text-text-warning-secondary" />
    </Tooltip>
  )
}
export default React.memo(McpToolNotSupportTooltip)
