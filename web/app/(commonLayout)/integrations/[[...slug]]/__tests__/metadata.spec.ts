import { generateMetadata } from '../layout'

vi.mock('server-only', () => ({}))

vi.mock('@/app/components/integrations', () => ({
  default: () => null,
}))

vi.mock('@/i18n-config/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n-config/server')>()),
  getLocaleOnServer: async () => 'en-US',
}))

describe('integrations route metadata', () => {
  it.each([
    [['model-provider'], 'Model Provider · Integrations'],
    [['tools', 'built-in'], 'Tool Plugin · Integrations'],
    [['tools', 'api'], 'Swagger API as Tool · Integrations'],
    [['tools', 'workflow'], 'Workflow as Tool · Integrations'],
    [['tools', 'mcp'], 'MCP · Integrations'],
    [['data-source'], 'Data Source · Integrations'],
    [['custom-endpoint'], 'Custom Endpoint · Integrations'],
    [['trigger'], 'Trigger · Integrations'],
    [['agent-strategy'], 'Agent Strategy · Integrations'],
    [['extension'], 'Extension · Integrations'],
  ])('provides metadata for /integrations/%s', async (slug, expectedTitle) => {
    await expect(generateMetadata({ params: Promise.resolve({ slug }) })).resolves.toMatchObject({
      title: expectedTitle,
    })
  })
})
