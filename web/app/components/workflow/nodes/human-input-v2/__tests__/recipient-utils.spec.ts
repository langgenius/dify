import type { HumanInputV2Recipient } from '../types'
import {
  addRecipient,
  createRecipientDraft,
  deriveRecipientSummary,
  findConflictingContact,
  getRecipientCanonicalKey,
  getRecipientValidationError,
  hasDuplicateRecipients,
  removeRecipient,
  replaceContactRecipient,
  updateRecipient,
} from '../recipient-utils'

describe('Human Input v2 recipient utilities', () => {
  const recipients: HumanInputV2Recipient[] = [
    { type: 'initiator' },
    { type: 'contact', contact_id: 'contact-evan' },
    { type: 'dynamic_email', selector: ['start', 'email'] },
    { type: 'onetime_email', email: 'Owner@Example.com' },
  ]

  it('constructs exact empty drafts for every recipient discriminator', () => {
    expect(
      (['contact', 'dynamic_email', 'onetime_email', 'initiator'] as const).map(
        createRecipientDraft,
      ),
    ).toEqual([
      { type: 'contact', contact_id: '' },
      { type: 'dynamic_email', selector: [] },
      { type: 'onetime_email', email: '' },
      { type: 'initiator' },
    ])
  })

  it('validates every recipient union and derives canonical duplicate keys', () => {
    expect(getRecipientValidationError({ type: 'contact', contact_id: '' })).toBe(
      'contact-required',
    )
    expect(getRecipientValidationError({ type: 'dynamic_email', selector: [] })).toBe(
      'selector-required',
    )
    expect(getRecipientValidationError({ type: 'onetime_email', email: 'invalid' })).toBe(
      'email-invalid',
    )
    expect(getRecipientCanonicalKey({ type: 'onetime_email', email: ' Owner@Example.com ' })).toBe(
      'onetime_email:owner@example.com',
    )
    expect(getRecipientCanonicalKey({ type: 'dynamic_email', selector: ['start', 'email'] })).toBe(
      'dynamic_email:start.email',
    )
  })

  it('keeps ordered immutable updates and prevents duplicate additions', () => {
    expect(addRecipient(recipients, { type: 'initiator' })).toBe(recipients)

    const added = addRecipient(recipients, {
      type: 'onetime_email',
      email: 'other@example.com',
    })
    expect(added.map((recipient) => recipient.type)).toEqual([
      'initiator',
      'contact',
      'dynamic_email',
      'onetime_email',
      'onetime_email',
    ])
    expect(updateRecipient(added, 1, { type: 'contact', contact_id: 'contact-amanda' })[0]).toBe(
      recipients[0],
    )
    expect(removeRecipient(added, 2)).toEqual([
      recipients[0],
      recipients[1],
      recipients[3],
      added[4],
    ])
  })

  it('detects imported duplicates without normalizing or deleting them', () => {
    const imported: HumanInputV2Recipient[] = [
      { type: 'initiator' },
      { type: 'initiator' },
      { type: 'onetime_email', email: 'owner@example.com' },
      { type: 'onetime_email', email: 'OWNER@example.com' },
    ]
    const snapshot = structuredClone(imported)

    expect(hasDuplicateRecipients(imported)).toBe(true)
    expect(imported).toEqual(snapshot)
  })

  it('derives empty, configured, overflow and invalid card summaries without mutation', () => {
    const labels = new Map([
      ['contact-evan', 'Evan Zhang'],
      ['contact-amanda', 'Amanda Lin'],
    ])
    expect(deriveRecipientSummary([]).state).toBe('empty')
    expect(deriveRecipientSummary([{ type: 'initiator' }]).state).toBe('configured')
    expect(
      deriveRecipientSummary(
        [
          { type: 'contact', contact_id: 'contact-evan' },
          { type: 'contact', contact_id: 'contact-amanda' },
          { type: 'initiator' },
          { type: 'onetime_email', email: 'owner@example.com' },
        ],
        labels,
      ),
    ).toMatchObject({ state: 'overflow', overflowCount: 1, contactCount: 2, hasInitiator: true })
    expect(
      deriveRecipientSummary([{ type: 'contact', contact_id: 'unresolved' }], labels).state,
    ).toBe('invalid')
  })

  it('keeps the whole-workspace selector distinct from the initiator and detects repeated imports', () => {
    const allContacts: HumanInputV2Recipient = { type: 'all_workspace_contacts' }
    const selected: HumanInputV2Recipient[] = [allContacts, { type: 'initiator' }]
    expect(getRecipientValidationError(allContacts)).toBeUndefined()
    expect(createRecipientDraft('all_workspace_contacts')).toEqual(allContacts)
    expect(addRecipient(selected, allContacts)).toBe(selected)
    expect(hasDuplicateRecipients(selected)).toBe(false)
    expect(hasDuplicateRecipients([allContacts, allContacts])).toBe(true)
    expect(deriveRecipientSummary([allContacts])).toMatchObject({
      state: 'configured',
      hasAllWorkspaceContacts: true,
      hasInitiator: false,
    })
    expect(deriveRecipientSummary(selected)).toMatchObject({
      state: 'configured',
      hasAllWorkspaceContacts: true,
      hasInitiator: true,
    })
    expect(removeRecipient(selected, 0)).toEqual([{ type: 'initiator' }])
  })

  it('locks only other contacts with the same normalized email', () => {
    const contacts = [
      { id: 'alice', email: ' Alice@Example.com ' },
      { id: 'alice-external', email: 'alice@example.com' },
      { id: 'unknown', email: '' },
    ]
    const selected: HumanInputV2Recipient[] = [
      { type: 'contact', contact_id: 'alice' },
      { type: 'onetime_email', email: 'bob@example.com' },
    ]

    expect(findConflictingContact(selected, contacts[1]!, contacts)).toEqual(contacts[0])
    expect(findConflictingContact(selected, contacts[0]!, contacts)).toBeUndefined()
    expect(
      findConflictingContact(selected, { id: 'bob', email: 'bob@example.com' }, contacts),
    ).toBeUndefined()
    expect(findConflictingContact(selected, contacts[2]!, contacts)).toBeUndefined()
    expect(
      findConflictingContact(selected, { id: 'missing', email: 'other@example.com' }, contacts),
    ).toBeUndefined()
  })

  it('replaces the occupying contact in place without changing other recipient identities', () => {
    const selected: HumanInputV2Recipient[] = [
      { type: 'initiator' },
      { type: 'contact', contact_id: 'alice' },
      { type: 'onetime_email', email: 'alice@example.com' },
      { type: 'contact', contact_id: 'bob' },
    ]
    const snapshot = structuredClone(selected)

    expect(replaceContactRecipient(selected, 'alice', 'alice-external')).toEqual([
      selected[0],
      { type: 'contact', contact_id: 'alice-external' },
      selected[2],
      selected[3],
    ])
    expect(selected).toEqual(snapshot)
    expect(replaceContactRecipient(selected, 'missing', 'alice-external')).toBe(selected)
    expect(replaceContactRecipient(selected, 'alice', 'bob')).toBe(selected)
  })
})
