import type {
  ContactsFeatureContextValue,
  ContactsListQuery,
  OrganizationCandidateQuery,
} from './types'

export const contactsManagementQueryKeys = {
  all: (workspaceId: string) => ['contacts-management', workspaceId] as const,
  detail: (workspaceId: string, contactId: string) =>
    [...contactsManagementQueryKeys.all(workspaceId), 'detail', contactId] as const,
  directory: (
    context: Pick<ContactsFeatureContextValue, 'deployment' | 'workspaceId'>,
    query: Omit<ContactsListQuery, 'cursor' | 'deployment'>,
  ) =>
    [
      ...contactsManagementQueryKeys.all(context.workspaceId),
      'directory',
      context.deployment,
      query,
    ] as const,
  organizationCandidates: (
    workspaceId: string,
    query: Omit<OrganizationCandidateQuery, 'cursor'>,
  ) => [...contactsManagementQueryKeys.all(workspaceId), 'organization-candidates', query] as const,
}
