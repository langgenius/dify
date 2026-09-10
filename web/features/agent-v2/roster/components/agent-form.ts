import type {
  AgentAppCreatePayload,
  AgentAppPartial,
} from '@dify/contracts/api/console/agent/types.gen'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'

type AgentFormField = 'description' | 'name' | 'role'

export type AgentFormValues = {
  [Field in AgentFormField]-?: NonNullable<AgentAppCreatePayload[Field]>
}

export type AgentFormSource = Pick<
  AgentAppPartial,
  'description' | 'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'name' | 'role'
>

export type AgentIconSelection =
  | AppIconSelection
  | {
      type: 'link'
      icon: string
      url: string
    }

export const defaultAgentIcon = {
  type: 'emoji',
  icon: '🧸',
  background: '#F5F3FF',
} satisfies AppIconSelection

type AgentIconSource = {
  icon?: string | null
  icon_background?: string | null
  icon_type?: string | null
  icon_url?: string | null
}

export const createAgentIconSelection = (agent: AgentIconSource): AgentIconSelection => {
  if (agent.icon_type === 'image' && agent.icon) {
    return {
      type: 'image',
      fileId: agent.icon,
      url: agent.icon_url ?? agent.icon,
    }
  }

  if (agent.icon_type === 'link' && agent.icon) {
    return {
      type: 'link',
      icon: agent.icon,
      url: agent.icon,
    }
  }

  return {
    type: 'emoji',
    icon: agent.icon || defaultAgentIcon.icon,
    background: agent.icon_background || defaultAgentIcon.background,
  }
}

export const getAgentIconKey = (icon: AgentIconSelection) => {
  if (icon.type === 'emoji') return `${icon.type}:${icon.icon}:${icon.background}`

  if (icon.type === 'image') return `${icon.type}:${icon.fileId}`

  return `${icon.type}:${icon.icon}`
}
