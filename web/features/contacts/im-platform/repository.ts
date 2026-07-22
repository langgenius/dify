import type {
  AuthorizeContactImProviderCommand,
  ContactImIntegrationView,
  ContactImOrganizationCommand,
  ContactImPage,
  ContactImProviderCommand,
  ContactImProviderDefinition,
  ContactImSyncItemView,
  ContactImSyncRunView,
  ListContactImSyncItemsInput,
  SaveContactImCredentialsCommand,
  TestContactImConnectionCommand,
} from './types'

export type ContactImPlatformRepository = {
  authorizeProvider: (
    command: AuthorizeContactImProviderCommand,
  ) => Promise<ContactImIntegrationView>
  disconnect: (command: ContactImProviderCommand) => Promise<ContactImIntegrationView[]>
  getActiveSync: (organizationId: string) => Promise<ContactImSyncRunView | null>
  getIntegrations: (organizationId: string) => Promise<ContactImIntegrationView[]>
  getProviderDefinitions: (organizationId: string) => Promise<ContactImProviderDefinition[]>
  getSyncItems: (
    input: ListContactImSyncItemsInput,
  ) => Promise<ContactImPage<ContactImSyncItemView>>
  getSyncRun: (runId: string) => Promise<ContactImSyncRunView>
  queryKey: string
  saveCredentials: (command: SaveContactImCredentialsCommand) => Promise<ContactImIntegrationView>
  startSync: (command: ContactImOrganizationCommand) => Promise<ContactImSyncRunView>
  testConnection: (command: TestContactImConnectionCommand) => Promise<ContactImIntegrationView>
}
