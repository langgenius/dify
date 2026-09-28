import type { AppIconType } from '@/types/app'

type AgentIconSource = {
  icon?: string | null
  icon_type?: string | null
  icon_url?: string | null
}

type AgentIconProps = {
  iconType: AppIconType | null
  imageUrl?: string
}

/**
 * Resolve `AppIcon` props for an Agent.
 *
 * Uploaded image icons store an upload file id in `icon`; the browser-loadable
 * signed URL is `icon_url`. Link icons store the URL itself in `icon`.
 */
export function getAgentIconProps(agent: AgentIconSource): AgentIconProps {
  switch (agent.icon_type) {
    case 'image':
      return { iconType: 'image', imageUrl: agent.icon_url ?? undefined }
    case 'link':
      return { iconType: 'image', imageUrl: agent.icon ?? undefined }
    case 'emoji':
      return { iconType: 'emoji' }
    default:
      return { iconType: null }
  }
}
