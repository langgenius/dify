import type { HumanInputContact } from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  AddPlatformContactsCommand,
  AddPlatformContactsResult,
  AvailablePlatformContact,
  AvailablePlatformContactsQuery,
  ContactPage,
  ContactsListQuery,
  ContactView,
  CreateExternalContactCommand,
  CreateExternalContactResult,
  ExternalContactInviteConflict,
  FindExternalContactsByEmailsCommand,
  RemoveContactsCommand,
  RemoveContactsResult,
  RemoveMemberCommand,
  RemoveMemberResult,
  UpdateExternalContactCommand,
  UpdateExternalContactResult,
  UpgradeExternalContactsToWorkspaceCommand,
  UpgradeExternalContactsToWorkspaceResult,
} from './types'
import { consoleClient } from '@/service/client'

/**
 * UI-facing repository boundary. Network-backed implementations map kind to group, search to
 * keyword, displayName to name, and contactIds to the endpoint-specific candidate_ids or
 * contact_ids field.
 */
export type ContactsManagementRepository = {
  supportsMemberManagement?: boolean
  supportsPlatformImport?: boolean
  getContact: (contactId: string) => Promise<ContactView | null>
  addPlatformContacts: (command: AddPlatformContactsCommand) => Promise<AddPlatformContactsResult>
  createExternalContact: (
    command: CreateExternalContactCommand,
  ) => Promise<CreateExternalContactResult>
  findExternalContactsByEmails: (
    command: FindExternalContactsByEmailsCommand,
  ) => Promise<ExternalContactInviteConflict[]>
  listAvailablePlatformContacts: (
    query: AvailablePlatformContactsQuery,
  ) => Promise<ContactPage<AvailablePlatformContact>>
  listContacts: (query: ContactsListQuery) => Promise<ContactPage<ContactView>>
  removeContacts: (command: RemoveContactsCommand) => Promise<RemoveContactsResult>
  removeMember: (command: RemoveMemberCommand) => Promise<RemoveMemberResult>
  updateExternalContact: (
    command: UpdateExternalContactCommand,
  ) => Promise<UpdateExternalContactResult>
  upgradeExternalContactsToWorkspace: (
    command: UpgradeExternalContactsToWorkspaceCommand,
  ) => Promise<UpgradeExternalContactsToWorkspaceResult>
}

function toContactView(contact: HumanInputContact): ContactView {
  return {
    ...contact,
    avatar_url: contact.avatar_url ?? '',
    email: contact.email ?? null,
    im_bindings: contact.im_bindings ?? [],
  }
}

function hasStatus(error: unknown, status: number) {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status
}

export function createContactsApiRepository(
  client = consoleClient.workspaces.current.humanInput,
): ContactsManagementRepository {
  const unsupported = async (): Promise<never> => {
    throw new Error('This contact operation is not connected yet')
  }

  return {
    supportsMemberManagement: false,
    supportsPlatformImport: false,
    async listContacts(query) {
      const result = await client.contacts.get(
        {
          query: {
            page: query.page,
            limit: query.limit,
            group: query.kind === 'all' ? undefined : query.kind,
            keyword: query.search.trim() || undefined,
          },
        },
        { context: { silent: true } },
      )
      return {
        ...result,
        data: result.data.map(toContactView),
        has_more: result.page * result.limit < result.total,
      }
    },
    async getContact(contactId) {
      try {
        const result = await client.contacts.byContactId.get(
          { params: { contact_id: contactId } },
          { context: { silent: true } },
        )
        return toContactView(result.contact)
      } catch (error) {
        if (hasStatus(error, 404)) return null
        throw error
      }
    },
    async createExternalContact(command) {
      try {
        const result = await client.contacts.external.post(
          { body: { name: command.displayName, email: command.email } },
          { context: { silent: true } },
        )
        return { kind: 'created', contactId: result.contact.id }
      } catch (error) {
        return { kind: hasStatus(error, 409) ? 'duplicate_external_contact' : 'failed' }
      }
    },
    async updateExternalContact(command) {
      try {
        const result = await client.contacts.external.byContactId.patch(
          {
            params: { contact_id: command.contactId },
            body: { name: command.displayName, email: command.email },
          },
          { context: { silent: true } },
        )
        return { kind: 'updated', contactId: result.contact.id }
      } catch (error) {
        return { kind: hasStatus(error, 409) ? 'duplicate_external_contact' : 'failed' }
      }
    },
    async removeContacts(command) {
      try {
        const result = await client.contacts.remove.post(
          { body: { contact_ids: command.contactIds } },
          { context: { silent: true } },
        )
        return { kind: 'removed', removedContactIds: result.removed_contact_ids }
      } catch {
        return { kind: 'failed' }
      }
    },
    addPlatformContacts: unsupported,
    findExternalContactsByEmails: unsupported,
    listAvailablePlatformContacts: unsupported,
    removeMember: unsupported,
    upgradeExternalContactsToWorkspace: unsupported,
  }
}
