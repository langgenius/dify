import type { AgentIconType, AgentLogSourceResponse } from '@dify/contracts/api/console/agent/types.gen'
import AppIcon from '@/app/components/base/app-icon'

const getLogSourceImageUrl = (source?: AgentLogSourceResponse | null) =>
  (source?.app_icon_type === 'image' || source?.app_icon_type === 'link')
    ? source.app_icon
    : undefined

const getLogSourceIconType = (source?: AgentLogSourceResponse | null) => {
  const imageUrl = getLogSourceImageUrl(source)
  return (imageUrl ? 'image' : source?.app_icon_type) as AgentIconType | null | undefined
}

export function LogSourceIcon({
  source,
}: {
  source?: AgentLogSourceResponse | null
}) {
  if (!source)
    return <span aria-hidden className="i-ri-apps-2-line size-5 shrink-0 text-text-quaternary" />

  return (
    <AppIcon
      size="xs"
      rounded
      iconType={getLogSourceIconType(source)}
      icon={source.app_icon ?? undefined}
      background={source.app_icon_background}
      imageUrl={getLogSourceImageUrl(source)}
      className="size-5 text-sm"
    />
  )
}
