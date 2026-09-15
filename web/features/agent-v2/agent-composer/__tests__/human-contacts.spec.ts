import type {
  AgentHumanContactConfig,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type { Member } from '@/models/common'
import { createStore } from 'jotai'
import { describe, expect, it } from 'vite-plus/test'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '../conversions'
import {
  createAgentHumanMention,
  getAgentHumanContactAliases,
  getAgentHumanContactId,
  getHumanMentionRefIds,
  memberToAgentHumanContact,
  promptHasHumanMention,
} from '../human-contacts'
import { agentComposerDraftAtom } from '../store'
import {
  addHumanContactAtom,
  agentComposerHumanContactsAtom,
  removeHumanContactAtom,
} from '../store-modules/human-contacts'
import { agentComposerPromptAtom } from '../store-modules/prompt'

const alice: AgentHumanContactConfig = {
  id: 'human-1',
  name: 'Alice',
  email: 'alice@example.com',
}

const bob: AgentHumanContactConfig = {
  contact_id: 'human-2',
  name: 'Bob',
  email: 'bob@example.com',
}

describe('Agent composer human contacts', () => {
  it('round-trips human contacts through the central Agent Composer conversion', () => {
    const baseConfig = {
      schema_version: 1,
      prompt: { system_prompt: `Escalate to ${createAgentHumanMention(alice)}` },
      human: { contacts: [alice] },
    } as AgentSoulConfig

    const formState = agentSoulConfigToFormState(baseConfig)
    expect(formState.humanContacts).toEqual([alice])

    const roundTrip = formStateToAgentSoulConfig({ baseConfig, formState })
    expect(roundTrip.human?.contacts).toEqual([alice])
    expect(roundTrip.prompt).toEqual(baseConfig.prompt)
  })

  it('maps an existing workspace member to the runtime contact contract', () => {
    const member = {
      id: 'account-1',
      name: 'Alice',
      email: 'alice@example.com',
      avatar: '',
      avatar_url: null,
      status: 'active',
      role: 'editor',
      roles: [],
    } as Member

    expect(memberToAgentHumanContact(member)).toEqual({
      id: 'account-1',
      name: 'Alice',
      email: 'alice@example.com',
      channel: 'email',
    })
  })

  it('uses stable contact identifiers and aliases across supported contact shapes', () => {
    expect(getAgentHumanContactId(alice)).toBe('human-1')
    expect(getAgentHumanContactId(bob)).toBe('human-2')
    expect(getAgentHumanContactId({ email: 'fallback@example.com' })).toBe(
      'fallback@example.com',
    )
    expect(getAgentHumanContactId({ name: 'Reviewer' })).toBe('Reviewer')
    expect(createAgentHumanMention({ name: 'Reviewer' })).toBe('[§human:Reviewer:Reviewer§]')
    expect(getAgentHumanContactAliases(alice)).toEqual([
      'human-1',
      'alice@example.com',
      'Alice',
    ])
  })

  it('parses human references exactly instead of matching identifier prefixes', () => {
    const prompt = '[§human:human-10:Eve§] [§human:alice@example.com:Alice§]'

    expect(getHumanMentionRefIds(prompt)).toEqual(new Set(['human-10', 'alice@example.com']))
    expect(promptHasHumanMention(prompt, alice)).toBe(true)
    expect(
      promptHasHumanMention(prompt, {
        id: 'human-1',
        name: 'Different person',
      }),
    ).toBe(false)
  })

  it('adds contacts once without mutating Prompt text', () => {
    const store = createStore()

    store.set(addHumanContactAtom, alice)
    store.set(addHumanContactAtom, alice)
    store.set(addHumanContactAtom, bob)

    expect(store.get(agentComposerHumanContactsAtom)).toEqual([alice, bob])
    expect(store.get(agentComposerDraftAtom).humanContacts).toEqual([alice, bob])
    expect(store.get(agentComposerPromptAtom)).toBe('')
  })

  it('removes a contact and all matching prompt aliases together', () => {
    const store = createStore()
    store.set(addHumanContactAtom, alice)
    store.set(addHumanContactAtom, bob)
    store.set(
      agentComposerPromptAtom,
      `${createAgentHumanMention(alice)} ${createAgentHumanMention(bob)}`,
    )

    store.set(removeHumanContactAtom, 'human-1')

    expect(store.get(agentComposerHumanContactsAtom)).toEqual([bob])
    expect(store.get(agentComposerPromptAtom)).not.toContain(createAgentHumanMention(alice))
    expect(store.get(agentComposerPromptAtom)).toContain(createAgentHumanMention(bob))
  })

  it('preserves a configured contact when the prompt references one of its aliases', () => {
    const store = createStore()
    store.set(addHumanContactAtom, alice)

    store.set(agentComposerPromptAtom, 'Escalate to [§human:alice@example.com:Alice§]')

    expect(store.get(agentComposerHumanContactsAtom)).toEqual([alice])
  })

  it('drops a configured contact when only a prefixed identifier remains', () => {
    const store = createStore()
    store.set(addHumanContactAtom, alice)

    store.set(agentComposerPromptAtom, 'Escalate to [§human:human-10:Eve§]')

    expect(store.get(agentComposerHumanContactsAtom)).toEqual([])
  })

  it('removes human mentions that use any supported alias for the contact', () => {
    const store = createStore()
    store.set(addHumanContactAtom, alice)
    store.set(
      agentComposerPromptAtom,
      '[§human:human-1:Alice§] and [§human:alice@example.com:Alice§]',
    )

    store.set(removeHumanContactAtom, 'human-1')

    expect(store.get(agentComposerHumanContactsAtom)).toEqual([])
    expect(store.get(agentComposerPromptAtom)).not.toContain('[§human:')
  })

  it('drops configured contacts when their human mention is manually removed', () => {
    const store = createStore()
    store.set(addHumanContactAtom, alice)
    store.set(addHumanContactAtom, bob)

    store.set(agentComposerPromptAtom, `Only keep ${createAgentHumanMention(bob)}`)

    expect(store.get(agentComposerHumanContactsAtom)).toEqual([bob])
  })
})
