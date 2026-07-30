'use client'

import type { AccessPoint } from './access-point'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'

const ACCESS_POINT_ICON_CLASS_NAMES: Record<AccessPoint, string> = {
  mcp: 'i-custom-vender-integrations-mcp',
  serviceApi: 'i-custom-vender-knowledge-api-aggregate',
  trigger: 'i-custom-vender-integrations-trigger',
  webApp: 'i-ri-robot-2-line',
}

function useAccessPointLabels() {
  const { t: tAgent } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')

  return {
    mcp: 'MCP',
    serviceApi: tAgent(($) => $['agentDetail.access.serviceApi.title']),
    trigger: tCommon(($) => $['settings.trigger']),
    webApp: tAgent(($) => $['agentDetail.access.webApp.title']),
  } satisfies Record<AccessPoint, string>
}

export function AccessPointIcon({
  active,
  accessPoint,
}: {
  active: boolean
  accessPoint: AccessPoint
}) {
  const { t } = useTranslation('agentV2')
  const labels = useAccessPointLabels()
  const status = active
    ? t(($) => $['agentDetail.access.status.inService'])
    : t(($) => $['agentDetail.access.status.outOfService'])
  const label = `${labels[accessPoint]} · ${status}`

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              'flex size-5 shrink-0 cursor-default items-center justify-center rounded-md border border-divider-regular text-text-secondary shadow-xs outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              !active && 'opacity-30',
            )}
          >
            <span
              aria-hidden
              className={cn(ACCESS_POINT_ICON_CLASS_NAMES[accessPoint], 'size-3')}
            />
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
