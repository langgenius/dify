import type { HumanInputV2Recipient } from '../types'
import {
  addRecipient,
  createRecipientDraft,
  deriveRecipientSummary,
  getRecipientCanonicalKey,
  getRecipientValidationError,
  hasDuplicateRecipients,
  removeRecipient,
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
})
