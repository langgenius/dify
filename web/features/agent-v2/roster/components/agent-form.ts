import type {
  AgentAppCreatePayload,
  AgentAppPartial,
} from '@dify/contracts/api/console/agent/types.gen'
import type { AgentComposerAgentResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'

export type AgentFormValues = {
  name: AgentAppCreatePayload['name']
  description: NonNullable<AgentAppCreatePayload['description']>
  role: NonNullable<AgentAppCreatePayload['role']>
  icon: IconPickerInputValue
}

export type AgentFormSource = Pick<
  AgentAppPartial,
  'description' | 'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'name' | 'role'
>

export const defaultAgentIcon = {
  type: 'emoji',
  icon: '🧸',
  background: '#F5F3FF',
} satisfies IconPickerValue

type AgentIconSource =
  | Pick<AgentAppPartial, 'icon' | 'icon_background' | 'icon_type' | 'icon_url'>
  | Pick<AgentComposerAgentResponse, 'icon' | 'icon_background' | 'icon_type'>

export const createAgentIconSelection = (agent: AgentIconSource): IconPickerInputValue => {
  if (agent.icon_type === 'image' && agent.icon) {
    return {
      type: 'image',
      fileId: agent.icon,
      url: ('icon_url' in agent ? agent.icon_url : undefined) ?? agent.icon,
    }
  }

  if (agent.icon_type === 'link' && agent.icon) {
    return {
      type: 'link',
      url: agent.icon,
    }
  }

  return {
    type: 'emoji',
    icon: agent.icon || defaultAgentIcon.icon,
    background: agent.icon_background || defaultAgentIcon.background,
  }
}

export const getAgentIconKey = (icon: IconPickerInputValue) => {
  if (icon.type === 'emoji') return `${icon.type}:${icon.icon}:${icon.background}`

  if (icon.type === 'image') return `${icon.type}:${icon.fileId}`

  return `${icon.type}:${icon.url}`
}

export const createAgentFormPayload = ({ icon, name, description, role }: AgentFormValues) =>
  ({
    name: name.trim(),
    description: description.trim(),
    // An empty role intentionally clears the backing agent's role.
    role: role.trim(),
    icon_type: icon.type,
    icon: icon.type === 'image' ? icon.fileId : icon.type === 'link' ? icon.url : icon.icon,
    icon_background: icon.type === 'emoji' ? icon.background : undefined,
  }) satisfies AgentAppCreatePayload
