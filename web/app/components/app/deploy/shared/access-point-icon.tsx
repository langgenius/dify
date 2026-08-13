'use client'

import type { AccessPoint } from '../access-point'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

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
  href,
}: {
  active: boolean
  accessPoint: AccessPoint
  href: string
}) {
  const { t } = useTranslation('agentV2')
  const labels = useAccessPointLabels()
  const status = active
    ? t(($) => $['agentDetail.access.status.inService'])
    : t(($) => $['agentDetail.access.status.outOfService'])
  const label = `${labels[accessPoint]} · ${status}`
  const triggerClassName = cn(
    'flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-regular text-text-secondary shadow-xs outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
    active ? 'cursor-pointer hover:bg-state-base-hover' : 'cursor-not-allowed opacity-30',
  )
  const icon = (
    <span aria-hidden className={cn(ACCESS_POINT_ICON_CLASS_NAMES[accessPoint], 'size-3')} />
  )

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          active ? (
            <Link href={href} aria-label={label} className={triggerClassName}>
              {icon}
            </Link>
          ) : (
            <button type="button" aria-label={label} className={triggerClassName} disabled>
              {icon}
            </button>
          )
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
