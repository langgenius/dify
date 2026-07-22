import type {
  AddPlatformContactsCommand,
  AddPlatformContactsResult,
  AvailablePlatformContactsQuery,
  ContactPage,
  ContactsListQuery,
  ContactView,
  CreateExternalContactCommand,
  CreateExternalContactResult,
  MemberRemovalImpact,
  PlatformContactView,
  RemoveContactsCommand,
  RemoveContactsResult,
  RemoveMemberCommand,
  RemoveMemberResult,
} from './types'

export type ContactsManagementRepository = {
  addPlatformContacts: (command: AddPlatformContactsCommand) => Promise<AddPlatformContactsResult>
  createExternalContact: (
    command: CreateExternalContactCommand,
  ) => Promise<CreateExternalContactResult>
  getContact: (contactId: string) => Promise<ContactView | null>
  getMemberRemovalImpact: (memberId: string) => Promise<MemberRemovalImpact>
  listAvailablePlatformContacts: (
    query: AvailablePlatformContactsQuery,
  ) => Promise<ContactPage<PlatformContactView>>
  listContacts: (query: ContactsListQuery) => Promise<ContactPage<ContactView>>
  removeContacts: (command: RemoveContactsCommand) => Promise<RemoveContactsResult>
  removeMember: (command: RemoveMemberCommand) => Promise<RemoveMemberResult>
}
