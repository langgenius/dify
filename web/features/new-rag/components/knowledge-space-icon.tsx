import type { ComponentProps } from 'react'
import AppIcon from '@/app/components/base/app-icon'

const DEFAULT_KNOWLEDGE_SPACE_ICON = '📙'
export const DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND = '#F0F9FF'

function resolveKnowledgeSpaceIcon(icon: string | null | undefined) {
  if (!icon || icon.startsWith('builtin:')) return DEFAULT_KNOWLEDGE_SPACE_ICON
  return icon
}

export function KnowledgeSpaceIcon({
  background,
  icon,
  size,
}: {
  background?: string | null
  icon?: string | null
  size: ComponentProps<typeof AppIcon>['size']
}) {
  return (
    <AppIcon
      icon={{
        icon: resolveKnowledgeSpaceIcon(icon),
        icon_type: 'emoji',
        icon_background: background ?? DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND,
      }}
      size={size}
    />
  )
}
