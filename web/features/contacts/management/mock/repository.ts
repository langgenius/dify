import type { ContactsManagementRepository } from '../repository'
import type { ContactPage } from '../types'
import type { ContactsMockScenarioDefinition } from './scenarios'

type CreateContactsMockRepositoryOptions = {
  scenario: ContactsMockScenarioDefinition
  wait?: () => Promise<void>
}

const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase()
const MOCK_CREATED_AT = Date.parse('2026-07-17T00:00:00.000Z') / 1000

const matchesSearch = (search: string, ...values: string[]) => {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  return (
    !normalizedSearch ||
    values.some((value) => value.toLocaleLowerCase().includes(normalizedSearch))
  )
}

function paginate<T>(items: T[], page: number, limit: number): ContactPage<T> {
  const offset = (page - 1) * limit
  const data = items.slice(offset, offset + limit)

  return {
    data: structuredClone(data),
    has_more: offset + data.length < items.length,
    limit,
    page,
    total: items.length,
  }
}

export function createContactsMockRepository({
  scenario,
  wait = async () => {},
}: CreateContactsMockRepositoryOptions): ContactsManagementRepository {
  let contacts = structuredClone(scenario.contacts)
  const availablePlatformContacts = structuredClone(scenario.availablePlatformContacts)
  let createdExternalCount = 0

  const getUnavailablePlatformContactIds = () =>
    new Set(contacts.filter((contact) => contact.type !== 'external').map((contact) => contact.id))
  const getUnavailablePlatformContactEmails = () =>
    new Set(
      contacts.flatMap((contact) =>
        contact.type !== 'external' && contact.email ? [normalizeEmail(contact.email)] : [],
      ),
    )
  const getWorkspaceContact = (memberId: string) => {
    const contactId = scenario.memberContactIds[memberId]
    return contacts.find((contact) => contact.id === contactId && contact.type === 'workspace')
  }

  return {
    async findExternalContactsByEmails(command) {
      await wait()
      const emails = new Set(command.emails.map(normalizeEmail))

      return contacts.flatMap((contact) => {
        if (
          contact.type !== 'external' ||
          !contact.email ||
          !emails.has(normalizeEmail(contact.email))
        ) {
          return []
        }

        return [{ email: contact.email, id: contact.id, name: contact.name }]
      })
    },

    async listContacts(query) {
      await wait()
      if (scenario.failures.directory) throw new Error('contacts_directory_failed')
      if (query.page > 1 && scenario.failures.nextPage) throw new Error('contacts_next_page_failed')

      const filtered = contacts.filter((contact) => {
        const matchesKind = query.kind === 'all' || contact.type === query.kind
        return matchesKind && matchesSearch(query.search, contact.name, contact.email ?? '')
      })

      return paginate(filtered, query.page, query.limit)
    },

    async createExternalContact(command) {
      await wait()
      if (scenario.failures.createExternal) return { kind: 'failed' }

      const email = normalizeEmail(command.email)
      const contact = contacts.find((item) => item.email && normalizeEmail(item.email) === email)
      if (contact?.type === 'external') {
        return { contactId: contact.id, kind: 'duplicate_external_contact' }
      }
      if (contact?.type === 'workspace') {
        return { contactId: contact.id, kind: 'matches_workspace_contact' }
      }
      if (contact?.type === 'platform') {
        return { contactId: contact.id, kind: 'matches_platform_contact' }
      }

      const availablePlatformContact = availablePlatformContacts.find(
        (item) => normalizeEmail(item.email) === email,
      )
      if (availablePlatformContact) {
        return { contactId: availablePlatformContact.id, kind: 'matches_platform_contact' }
      }

      createdExternalCount += 1
      const contactId = `contact-external-created-${createdExternalCount}`
      contacts = [
        ...contacts,
        {
          avatar_url: '',
          created_at: MOCK_CREATED_AT,
          email,
          id: contactId,
          im_bindings: [],
          name: command.displayName.trim(),
          type: 'external',
        },
      ]
      return { contactId, kind: 'created' }
    },

    async listAvailablePlatformContacts(query) {
      await wait()
      if (scenario.failures.platformContacts) throw new Error('platform_contacts_failed')

      const existingContactIds = getUnavailablePlatformContactIds()
      const existingEmails = getUnavailablePlatformContactEmails()
      const filtered = availablePlatformContacts.filter((contact) => {
        const isExisting =
          existingContactIds.has(contact.id) || existingEmails.has(normalizeEmail(contact.email))
        return !isExisting && matchesSearch(query.search, contact.name, contact.email)
      })
      return paginate(filtered, query.page, query.limit)
    },

    async addPlatformContacts(command) {
      await wait()
      if (scenario.failures.addPlatform) return { kind: 'failed' }

      const selectedContacts = availablePlatformContacts.filter((contact) =>
        command.contactIds.includes(contact.id),
      )
      const conflicts = selectedContacts.flatMap((platformContact) => {
        const existingContact = contacts.find(
          (contact) =>
            contact.type === 'external' &&
            contact.email &&
            normalizeEmail(contact.email) === normalizeEmail(platformContact.email),
        )
        if (!existingContact?.email) return []
        return [
          {
            contactId: existingContact.id,
            email: existingContact.email,
            platformContactId: platformContact.id,
          },
        ]
      })
      if (conflicts.length > 0 && !command.upgradeExternalContacts) {
        return { conflicts, kind: 'requires_external_contact_upgrade' }
      }

      const nextContacts = [...contacts]
      const contactIds: string[] = []
      for (const platformContact of selectedContacts) {
        const existingIndex = nextContacts.findIndex(
          (contact) =>
            contact.email &&
            normalizeEmail(contact.email) === normalizeEmail(platformContact.email),
        )
        const existingContact = nextContacts[existingIndex]
        if (existingContact) {
          if (existingContact.type === 'external' && command.upgradeExternalContacts) {
            nextContacts[existingIndex] = { ...existingContact, type: 'platform' }
            contactIds.push(existingContact.id)
          }
          continue
        }

        nextContacts.push({
          avatar_url: platformContact.avatar_url ?? '',
          created_at: MOCK_CREATED_AT,
          email: platformContact.email,
          id: platformContact.id,
          im_bindings: [],
          name: platformContact.name,
          type: 'platform' as const,
        })
        contactIds.push(platformContact.id)
      }

      contacts = nextContacts
      return { contactIds, kind: 'added' }
    },

    async removeContacts(command) {
      await wait()
      if (scenario.failures.contactRemoval) return { kind: 'failed' }

      const selectedIds = new Set(command.contactIds)
      const removedContactIds = contacts
        .filter((contact) => contact.type !== 'workspace' && selectedIds.has(contact.id))
        .map((contact) => contact.id)
      const removedIds = new Set(removedContactIds)
      contacts = contacts.filter((contact) => !removedIds.has(contact.id))

      return { kind: 'removed', removedContactIds }
    },

    async removeMember(command) {
      await wait()
      if (scenario.failures.removal) return { kind: 'failed' }

      const contact = getWorkspaceContact(command.memberId)
      if (!contact) {
        return { contactId: null, contactOutcome: 'not_found', kind: 'removed' }
      }

      if (scenario.deployment === 'ee' && command.keepAsPlatformContact) {
        contacts = contacts.map((item) => {
          if (item.id !== contact.id) return item
          return {
            ...item,
            type: 'platform',
          }
        })
        return {
          contactId: contact.id,
          contactOutcome: 'converted_to_platform',
          kind: 'removed',
        }
      }

      contacts = contacts.filter((item) => item.id !== contact.id)
      return { contactId: contact.id, contactOutcome: 'removed', kind: 'removed' }
    },

    async upgradeExternalContactsToWorkspace(command) {
      await wait()
      const selectedIds = new Set(command.contactIds)
      const contactIds: string[] = []

      contacts = contacts.map((contact) => {
        if (contact.type !== 'external' || !selectedIds.has(contact.id)) return contact
        contactIds.push(contact.id)
        return { ...contact, type: 'workspace' }
      })

      return { contactIds, kind: 'upgraded' }
    },
  }
}
