import type {
  AddPlatformContactsCommand,
  AddPlatformContactsResult,
  ContactPage,
  ContactsListQuery,
  ContactView,
  CreateExternalContactCommand,
  CreateExternalContactResult,
  MemberRemovalImpact,
  OrganizationCandidate,
  OrganizationCandidateQuery,
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
  listContacts: (query: ContactsListQuery) => Promise<ContactPage<ContactView>>
  removeMember: (command: RemoveMemberCommand) => Promise<RemoveMemberResult>
  searchOrganizationCandidates: (
    query: OrganizationCandidateQuery,
  ) => Promise<ContactPage<OrganizationCandidate>>
}
