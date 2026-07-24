import type {
  AvailablePlatformContactsQuery,
  ContactsFeatureContextValue,
  ContactsListQuery,
} from './types'

export const contactsManagementQueryKeys = {
  all: (workspaceId: string) => ['contacts-management', workspaceId] as const,
  directory: (
    context: Pick<ContactsFeatureContextValue, 'deployment' | 'workspaceId'>,
    query: Omit<ContactsListQuery, 'deployment' | 'page'>,
  ) =>
    [
      ...contactsManagementQueryKeys.all(context.workspaceId),
      'directory',
      context.deployment,
      query,
    ] as const,
  availablePlatformContacts: (
    workspaceId: string,
    query: Omit<AvailablePlatformContactsQuery, 'page'>,
  ) =>
    [
      ...contactsManagementQueryKeys.all(workspaceId),
      'available-platform-contacts',
      query,
    ] as const,
}
