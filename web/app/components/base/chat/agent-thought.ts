import type { AgentThought } from '@dify/contracts/api/console/agent/types.gen'
import type { ThoughtItem } from './chat/type'

function toToolLabels(value: AgentThought['tool_labels']): ThoughtItem['tool_labels'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const toolLabels: NonNullable<ThoughtItem['tool_labels']> = {}
  for (const [name, label] of Object.entries(value)) {
    if (!label || typeof label !== 'object' || Array.isArray(label)) continue

    const enUS = 'en_US' in label ? label.en_US : undefined
    const zhHans = 'zh_Hans' in label ? label.zh_Hans : undefined
    if (typeof enUS !== 'string' || typeof zhHans !== 'string') continue

    toolLabels[name] = { en_US: enUS, zh_Hans: zhHans }
    for (const [locale, localizedLabel] of Object.entries(label)) {
      if (typeof localizedLabel === 'string') toolLabels[name][locale] = localizedLabel
    }
  }

  return Object.keys(toolLabels).length ? toolLabels : undefined
}

export const toAgentThoughtItem = (thought: AgentThought, conversationId: string): ThoughtItem => ({
  id: thought.id,
  tool: thought.tool ?? '',
  thought: thought.thought ?? '',
  answer: thought.answer ?? '',
  tool_input: thought.tool_input ?? '',
  tool_labels: toToolLabels(thought.tool_labels),
  tool_activity: thought.tool_activity,
  message_id: thought.message_id,
  conversation_id: conversationId,
  observation: thought.observation ?? '',
  position: thought.position,
  files: thought.files,
})
