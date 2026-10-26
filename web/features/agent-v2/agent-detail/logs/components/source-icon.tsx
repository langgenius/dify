import type { AgentLogSourceResponse } from '@dify/contracts/api/console/agent/types.gen'
import AppIcon from '@/app/components/base/app-icon'

export function LogSourceIcon({ source }: { source?: AgentLogSourceResponse | null }) {
  if (!source)
    return <span aria-hidden className="i-ri-apps-2-line size-5 shrink-0 text-text-quaternary" />

  return (
    <AppIcon
      size="xs"
      className="size-5 text-sm"
      shape="circle"
      icon={{
        icon_type: source.app_icon_type,
        icon: source.app_icon,
        icon_url: source.app_icon,
        icon_background: source.app_icon_background,
      }}
    />
  )
}
