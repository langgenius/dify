import type { AgentHumanContactConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { Member } from '@/models/common'

export const getAgentHumanContactId = (contact: AgentHumanContactConfig) =>
  contact.id ?? contact.contact_id ?? contact.human_id ?? contact.email ?? contact.name ?? ''

export const getAgentHumanContactAliases = (contact: AgentHumanContactConfig) =>
  Array.from(
    new Set(
      [contact.id, contact.contact_id, contact.human_id, contact.email, contact.name].filter(
        (alias): alias is string => !!alias,
      ),
    ),
  )

export const memberToAgentHumanContact = (member: Member): AgentHumanContactConfig => ({
  id: member.id,
  name: member.name,
  email: member.email,
  channel: 'email',
})

const humanMentionPattern = String.raw`\[§human:([^:§\]\r\n]+)(?::[^§\]\r\n]*)?§\]`
const getHumanMentionRegex = () => new RegExp(humanMentionPattern, 'g')

export const getHumanMentionRefIds = (prompt: string) =>
  new Set(Array.from(prompt.matchAll(getHumanMentionRegex()), (match) => match[1] ?? ''))

export const promptHasHumanMention = (prompt: string, contact: AgentHumanContactConfig) => {
  const mentionedIds = getHumanMentionRefIds(prompt)
  return getAgentHumanContactAliases(contact).some((alias) => mentionedIds.has(alias))
}

export const createAgentHumanMention = (contact: AgentHumanContactConfig) => {
  const contactId = getAgentHumanContactId(contact)
  if (!contactId) return ''

  const label = (contact.name || contact.email || contactId).replace(/[§\]\r\n]/g, ' ').trim()
  return `[§human:${contactId}:${label || contactId}§]`
}

export const removeAgentHumanMentions = (prompt: string, contact: AgentHumanContactConfig) => {
  const aliases = new Set(getAgentHumanContactAliases(contact))
  if (!aliases.size) return prompt

  return prompt
    .replace(getHumanMentionRegex(), (token, refId: string) => (aliases.has(refId) ? '' : token))
    .replace(/[ \t]+\n/g, '\n')
}
