import type { ContactsManagementRepository } from '../repository'
import type { ContactPage } from '../types'
import type { ContactsMockScenarioDefinition } from './scenarios'

type CreateContactsMockRepositoryOptions = {
  scenario: ContactsMockScenarioDefinition
  wait?: () => Promise<void>
}

const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase()
const MOCK_CREATED_AT = Date.parse('2026-07-17T00:00:00.000Z')

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

  const getExistingContactIds = () => new Set(contacts.map((contact) => contact.id))
  const getExistingEmails = () =>
    new Set(contacts.flatMap((contact) => (contact.email ? [normalizeEmail(contact.email)] : [])))
  const getWorkspaceContact = (memberId: string) => {
    const contactId = scenario.memberContactIds[memberId]
    return contacts.find((contact) => contact.id === contactId && contact.type === 'workspace')
  }

  return {
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

      const existingContactIds = getExistingContactIds()
      const existingEmails = getExistingEmails()
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
      const existingEmails = getExistingEmails()
      const newContacts = selectedContacts.filter(
        (contact) => !existingEmails.has(normalizeEmail(contact.email)),
      )

      contacts = [
        ...contacts,
        ...newContacts.map((contact) => ({
          avatar_url: contact.avatar_url ?? '',
          created_at: MOCK_CREATED_AT,
          email: contact.email,
          id: contact.id,
          im_bindings: [],
          name: contact.name,
          type: 'platform' as const,
        })),
      ]
      return { contactIds: newContacts.map((contact) => contact.id), kind: 'added' }
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

    async getMemberRemovalImpact(memberId) {
      await wait()
      const contact = getWorkspaceContact(memberId)
      return {
        contactId: contact?.id ?? null,
        deployment: scenario.deployment,
        memberId,
      }
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
  }
}
