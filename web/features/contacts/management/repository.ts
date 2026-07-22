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
  RemoveContactsCommand,
  RemoveContactsResult,
  RemoveMemberCommand,
  RemoveMemberResult,
} from './types'

/**
 * UI-facing repository boundary. Network-backed implementations map kind to group, search to
 * keyword, displayName to name, and contactIds to the endpoint-specific candidate_ids or
 * contact_ids field.
 */
export type ContactsManagementRepository = {
  addPlatformContacts: (command: AddPlatformContactsCommand) => Promise<AddPlatformContactsResult>
  createExternalContact: (
    command: CreateExternalContactCommand,
  ) => Promise<CreateExternalContactResult>
  listAvailablePlatformContacts: (
    query: AvailablePlatformContactsQuery,
  ) => Promise<ContactPage<AvailablePlatformContact>>
  listContacts: (query: ContactsListQuery) => Promise<ContactPage<ContactView>>
  removeContacts: (command: RemoveContactsCommand) => Promise<RemoveContactsResult>
  removeMember: (command: RemoveMemberCommand) => Promise<RemoveMemberResult>
}
