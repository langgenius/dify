import type {
  AvailablePlatformContactsQuery,
  ContactsFeatureContextValue,
  ContactsListQuery,
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
  availablePlatformContacts: (
    workspaceId: string,
    query: Omit<AvailablePlatformContactsQuery, 'cursor'>,
  ) =>
    [
      ...contactsManagementQueryKeys.all(workspaceId),
      'available-platform-contacts',
      query,
    ] as const,
}
