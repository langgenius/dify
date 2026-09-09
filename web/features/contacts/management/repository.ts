import type { HumanInputContact } from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  AddPlatformContactsCommand,
  AddPlatformContactsResult,
  AvailablePlatformContact,
  AvailablePlatformContactsQuery,
  ContactIMIdentity,
  ContactPage,
  ContactsFeatureContextValue,
  ContactsListQuery,
  ContactView,
  CreateExternalContactCommand,
  CreateExternalContactResult,
  ExternalContactInviteConflict,
  FindExternalContactsByEmailsCommand,
  RemoveContactIMBindingCommand,
  RemoveContactsCommand,
  RemoveContactsResult,
  RemoveMemberCommand,
  RemoveMemberResult,
  SetContactIMBindingCommand,
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
  supportsIMBindings?: boolean
  supportsMemberManagement?: boolean
  supportsPlatformImport?: boolean
  supportsExternalContactUpgrade?: boolean
  getContact: (contactId: string) => Promise<ContactView | null>
  listIMIdentities: (query: {
    search: string
    page: number
    limit: number
  }) => Promise<ContactPage<ContactIMIdentity>>
  setIMBinding: (command: SetContactIMBindingCommand) => Promise<ContactView>
  removeIMBinding: (command: RemoveContactIMBindingCommand) => Promise<void>
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

export class ContactIMRequestError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'ContactIMRequestError'
    this.code = code
  }
}

function errorRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

async function requestContactIM<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    const responseBody: unknown =
      error instanceof Response
        ? await error
            .clone()
            .json()
            .catch(() => undefined)
        : undefined
    const record = errorRecord(error)
    const data = errorRecord(record?.data)
    const body = errorRecord(responseBody) ?? errorRecord(data?.body) ?? data ?? record
    throw new ContactIMRequestError(
      typeof body?.code === 'string' ? body.code : 'im_binding_failed',
    )
  }
}

export function createContactsApiRepository(
  client = consoleClient.workspaces.current.humanInput,
  context?: ContactsFeatureContextValue,
): ContactsManagementRepository {
  const unsupported = async (): Promise<never> => {
    throw new Error('This contact operation is not connected yet')
  }
  const canImportPlatformContacts = Boolean(
    context?.workspaceId && context.deployment === 'ee' && context.permissions.canManageContacts,
  )

  return {
    supportsIMBindings: true,
    supportsMemberManagement: false,
    supportsPlatformImport: canImportPlatformContacts,
    supportsExternalContactUpgrade: false,
    async listAvailablePlatformContacts(query) {
      if (!canImportPlatformContacts) throw new Error('Platform contact import is not available')
      const result = await client.organizationCandidates.get(
        {
          query: {
            keyword: query.search.trim() || undefined,
            page: query.page,
            limit: query.limit,
          },
        },
        { context: { silent: true } },
      )
      const existing = result.data.length
        ? await client.contacts.batch.get(
            { query: { contact_ids: result.data.map((candidate) => candidate.id) } },
            { context: { silent: true } },
          )
        : { data: [] }
      const existingIds = new Set(existing.data.map((contact) => contact.id))
      return {
        ...result,
        data: result.data
          .filter((candidate) => !existingIds.has(candidate.id))
          .map((candidate) => ({ ...candidate, avatar_url: candidate.avatar_url ?? null })),
        has_more: result.page * result.limit < result.total,
      }
    },
    async addPlatformContacts(command) {
      if (!canImportPlatformContacts) return { kind: 'forbidden' }
      if (command.upgradeExternalContacts) return { kind: 'external_upgrade_unsupported' }
      if (command.contactIds.length === 0) return { kind: 'failed' }
      try {
        const result = await client.contacts.platform.post(
          { body: { candidate_ids: [...new Set(command.contactIds)] } },
          { context: { silent: true } },
        )
        if (result.data.length === 0) return { kind: 'failed' }
        return { kind: 'added', contactIds: result.data.map((contact) => contact.id) }
      } catch (error) {
        return {
          kind: hasStatus(error, 403) ? 'forbidden' : hasStatus(error, 409) ? 'conflict' : 'failed',
        }
      }
    },
    async listIMIdentities(query) {
      const result = await requestContactIM(() =>
        client.imIdentities.get(
          {
            query: {
              keyword: query.search.trim() || undefined,
              page: query.page,
              limit: query.limit,
            },
          },
          { context: { silent: true } },
        ),
      )
      return { ...result, has_more: result.page * result.limit < result.total }
    },
    async setIMBinding(command) {
      const input = {
        params: { contact_id: command.contactId },
        body: { identity_id: command.identityId },
      }
      const result = await requestContactIM(() =>
        command.override
          ? client.contacts.byContactId.imOverride.put(input, { context: { silent: true } })
          : client.contacts.byContactId.imBindings.put(input, { context: { silent: true } }),
      )
      return toContactView(result.contact)
    },
    async removeIMBinding(command) {
      await requestContactIM(async () => {
        const params = { contact_id: command.contactId }
        if (command.binding.scope === 'workspace') {
          await client.contacts.byContactId.imOverride.delete(
            { params },
            { context: { silent: true } },
          )
        } else {
          await client.contacts.byContactId.imBindings.delete(
            {
              params,
              query: { binding_id: command.binding.id },
            },
            { context: { silent: true } },
          )
        }
      })
    },
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
    findExternalContactsByEmails: unsupported,
    removeMember: unsupported,
    upgradeExternalContactsToWorkspace: unsupported,
  }
}
