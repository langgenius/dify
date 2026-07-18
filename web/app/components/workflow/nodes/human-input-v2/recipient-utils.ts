import type { HumanInputV2Recipient } from './types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/

export type RecipientValidationError = 'contact-required' | 'selector-required' | 'email-invalid'

export type HumanInputV2RecipientType = HumanInputV2Recipient['type']

export function createRecipientDraft(type: HumanInputV2RecipientType): HumanInputV2Recipient {
  switch (type) {
    case 'contact':
      return { type, contact_id: '' }
    case 'dynamic_email':
      return { type, selector: [] }
    case 'onetime_email':
      return { type, email: '' }
    case 'initiator':
      return { type }
  }
}

export function getRecipientValidationError(
  recipient: HumanInputV2Recipient,
): RecipientValidationError | undefined {
  if (recipient.type === 'contact' && !recipient.contact_id.trim()) return 'contact-required'
  if (
    recipient.type === 'dynamic_email' &&
    (!recipient.selector.length || recipient.selector.some((part) => !part.trim()))
  )
    return 'selector-required'
  if (recipient.type === 'onetime_email' && !EMAIL_PATTERN.test(recipient.email.trim()))
    return 'email-invalid'
}

export function getRecipientCanonicalKey(recipient: HumanInputV2Recipient): string | undefined {
  if (getRecipientValidationError(recipient)) return undefined

  switch (recipient.type) {
    case 'contact':
      return `contact:${recipient.contact_id}`
    case 'dynamic_email':
      return `dynamic_email:${recipient.selector.join('.')}`
    case 'onetime_email':
      return `onetime_email:${recipient.email.trim().toLowerCase()}`
    case 'initiator':
      return 'initiator'
  }
}

export function hasDuplicateRecipients(recipients: HumanInputV2Recipient[]): boolean {
  const keys = recipients.map(getRecipientCanonicalKey).filter((key): key is string => !!key)
  return new Set(keys).size !== keys.length
}

export function addRecipient(
  recipients: HumanInputV2Recipient[],
  recipient: HumanInputV2Recipient,
): HumanInputV2Recipient[] {
  const key = getRecipientCanonicalKey(recipient)
  if (!key || recipients.some((item) => getRecipientCanonicalKey(item) === key)) return recipients
  return [...recipients, recipient]
}

export function updateRecipient(
  recipients: HumanInputV2Recipient[],
  index: number,
  recipient: HumanInputV2Recipient,
): HumanInputV2Recipient[] {
  if (!recipients[index]) return recipients
  return recipients.map((item, itemIndex) => (itemIndex === index ? recipient : item))
}

export function removeRecipient(
  recipients: HumanInputV2Recipient[],
  index: number,
): HumanInputV2Recipient[] {
  return recipients.filter((_, itemIndex) => itemIndex !== index)
}

export type RecipientSummary = {
  state: 'empty' | 'configured' | 'overflow' | 'invalid'
  contactCount: number
  dynamicEmailCount: number
  onetimeEmailCount: number
  hasInitiator: boolean
  visibleLabels: string[]
  overflowCount: number
}

export function deriveRecipientSummary(
  recipients: HumanInputV2Recipient[],
  contactLabels: ReadonlyMap<string, string> = new Map(),
  visibleLimit = 3,
): RecipientSummary {
  if (!recipients.length) {
    return {
      state: 'empty',
      contactCount: 0,
      dynamicEmailCount: 0,
      onetimeEmailCount: 0,
      hasInitiator: false,
      visibleLabels: [],
      overflowCount: 0,
    }
  }

  let invalid = hasDuplicateRecipients(recipients)
  let contactCount = 0
  let dynamicEmailCount = 0
  let onetimeEmailCount = 0
  let hasInitiator = false
  const labels = recipients.map((recipient) => {
    if (getRecipientValidationError(recipient)) invalid = true
    if (recipient.type === 'contact') {
      contactCount += 1
      const label = contactLabels.get(recipient.contact_id)
      if (!label) invalid = true
      return label || recipient.contact_id || 'contact'
    }
    if (recipient.type === 'dynamic_email') {
      dynamicEmailCount += 1
      return recipient.selector.join(' / ') || 'dynamic_email'
    }
    if (recipient.type === 'onetime_email') {
      onetimeEmailCount += 1
      return recipient.email
    }
    hasInitiator = true
    return 'initiator'
  })
  const overflowCount = Math.max(0, labels.length - visibleLimit)

  return {
    state: invalid ? 'invalid' : overflowCount ? 'overflow' : 'configured',
    contactCount,
    dynamicEmailCount,
    onetimeEmailCount,
    hasInitiator,
    visibleLabels: labels.slice(0, visibleLimit),
    overflowCount,
  }
}
