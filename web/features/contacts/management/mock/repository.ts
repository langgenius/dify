import type { ContactsManagementRepository } from '../repository'
import type { ContactPage, ContactView } from '../types'
import type { ContactsMockScenarioDefinition } from './scenarios'

type CreateContactsMockRepositoryOptions = {
  scenario: ContactsMockScenarioDefinition
  wait?: () => Promise<void>
}

const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase()

const matchesSearch = (search: string, ...values: string[]) => {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  return (
    !normalizedSearch ||
    values.some((value) => value.toLocaleLowerCase().includes(normalizedSearch))
  )
}

function paginate<T>(items: T[], cursor: string | null, pageSize: number): ContactPage<T> {
  const offset = cursor ? Number.parseInt(cursor, 10) : 0
  const safeOffset = Number.isFinite(offset) ? offset : 0
  const pageItems = items.slice(safeOffset, safeOffset + pageSize)
  const nextOffset = safeOffset + pageItems.length

  return {
    items: structuredClone(pageItems),
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
  }
}

export function mergeContactPages(pages: ContactView[][]): ContactView[] {
  const contacts = new Map<string, ContactView>()

  for (const page of pages) {
    for (const contact of page) contacts.set(contact.id, contact)
  }

  return [...contacts.values()]
}

export function createContactsMockRepository({
  scenario,
  wait = async () => {},
}: CreateContactsMockRepositoryOptions): ContactsManagementRepository {
  let contacts = structuredClone(scenario.contacts)
  const availablePlatformContacts = structuredClone(scenario.availablePlatformContacts)
  let createdExternalCount = 0

  const getExistingContactIds = () => new Set(contacts.map((contact) => contact.id))
  const getExistingEmails = () => new Set(contacts.map((contact) => normalizeEmail(contact.email)))

  return {
    async listContacts(query) {
      await wait()
      if (scenario.failures.directory) throw new Error('contacts_directory_failed')
      if (query.cursor && scenario.failures.nextPage) throw new Error('contacts_next_page_failed')

      const filtered = contacts.filter((contact) => {
        const matchesKind = query.kind === 'all' || contact.kind === query.kind
        return matchesKind && matchesSearch(query.search, contact.displayName, contact.email)
      })

      return paginate(filtered, query.cursor, query.pageSize)
    },

    async getContact(contactId) {
      await wait()
      if (scenario.failures.detail) throw new Error('contact_detail_failed')
      return structuredClone(contacts.find((contact) => contact.id === contactId) ?? null)
    },

    async createExternalContact(command) {
      await wait()
      if (scenario.failures.createExternal) return { kind: 'failed' }

      const email = normalizeEmail(command.email)
      const contact = contacts.find((item) => normalizeEmail(item.email) === email)
      if (contact?.kind === 'external') {
        return { contactId: contact.id, kind: 'duplicate_external_contact' }
      }
      if (contact?.kind === 'workspace') {
        return { contactId: contact.id, kind: 'matches_workspace_contact' }
      }
      if (contact?.kind === 'platform') {
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
          avatarUrl: null,
          channels: { email, imIdentities: [] },
          displayName: command.displayName.trim(),
          email,
          emailOnly: true,
          id: contactId,
          joinedAt: '2026-07-17T00:00:00.000Z',
          kind: 'external',
          workspaceId: command.workspaceId,
        },
      ]
      return { contactId, kind: 'created' }
    },

    async listAvailablePlatformContacts(query) {
      await wait()
      if (scenario.failures.platformContacts) throw new Error('platform_contacts_failed')

      const existingContactIds = getExistingContactIds()
      const existingEmails = getExistingEmails()
      const filtered = availablePlatformContacts.filter((contact) => {
        const isExisting =
          existingContactIds.has(contact.id) || existingEmails.has(normalizeEmail(contact.email))
        return !isExisting && matchesSearch(query.search, contact.displayName, contact.email)
      })
      return paginate(filtered, query.cursor, query.pageSize)
    },

    async addPlatformContacts(command) {
      await wait()
      if (scenario.failures.addPlatform) return { kind: 'failed' }

      const selectedContacts = availablePlatformContacts.filter((contact) =>
        command.contactIds.includes(contact.id),
      )
      const existingEmails = getExistingEmails()
      const newContacts = selectedContacts.filter(
        (contact) => !existingEmails.has(normalizeEmail(contact.email)),
      )

      contacts = [...contacts, ...structuredClone(newContacts)]
      return { contactIds: newContacts.map((contact) => contact.id), kind: 'added' }
    },

    async removeContacts(command) {
      await wait()
      if (scenario.failures.contactRemoval) return { kind: 'failed' }

      const selectedIds = new Set(command.contactIds)
      const removedContactIds = contacts
        .filter((contact) => contact.kind !== 'workspace' && selectedIds.has(contact.id))
        .map((contact) => contact.id)
      const removedIds = new Set(removedContactIds)
      contacts = contacts.filter((contact) => !removedIds.has(contact.id))

      return { kind: 'removed', removedContactIds }
    },

    async getMemberRemovalImpact(memberId) {
      await wait()
      const contact = contacts.find(
        (item) => item.kind === 'workspace' && item.memberId === memberId,
      )
      return {
        contactId: contact?.id ?? null,
        deployment: scenario.deployment,
        memberId,
      }
    },

    async removeMember(command) {
      await wait()
      if (scenario.failures.removal) return { kind: 'failed' }

      const contact = contacts.find(
        (item) => item.kind === 'workspace' && item.memberId === command.memberId,
      )
      if (!contact) {
        return { contactId: null, contactOutcome: 'not_found', kind: 'removed' }
      }

      if (scenario.deployment === 'ee' && command.keepAsPlatformContact) {
        contacts = contacts.map((item) => {
          if (item.id !== contact.id) return item
          return {
            avatarUrl: item.avatarUrl,
            channels: item.channels,
            displayName: item.displayName,
            email: item.email,
            id: item.id,
            joinedAt: item.joinedAt,
            kind: 'platform',
            organizationIdentity: `retained-${command.memberId}`,
            sourceWorkspaceSummary: 'Former workspace member',
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
  }
}
