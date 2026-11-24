import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createExternalAgentAsset,
  createExternalAgentCapabilities,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { apiError, installFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createRosterFixture } from './external-roster-fixture'

vi.unmock('react-i18next')

it('recovers a failed deletion-impact read before enabling deletion and shows the running-task warning once', async ({
  onTestFinished,
}) => {
  const agent = createExternalAgentAsset({ reference_count: 0 })
  const api = installFakeApi({
    console: {
      externalAgents: {
        capabilities: { get: () => createExternalAgentCapabilities() },
        get: () => ({
          items: [agent],
          total: 1,
          enabled_count: 1,
          disabled_count: 0,
          page: 1,
          limit: 20,
        }),
        byAgentId: {
          references: { get: () => createExternalAgentReferences({ may_have_in_flight: true }) },
          delete: () => {},
        },
      },
      tags: { get: () => [] },
    },
  })
  const references = api.console.externalAgents.byAgentId.references.get
  references.mockImplementationOnce(() => {
    throw apiError({ status: 503, message: 'Service unavailable' })
  })
  const fixture = await createRosterFixture()
  const { NavigationProvider } = createTestNavigation({ url: '/agents?agent_type=external' })
  await page.viewport(1440, 900)
  const rendered = await render(<NavigationProvider>{fixture.ui}</NavigationProvider>)
  onTestFinished(async () => {
    await rendered.unmount()
    fixture.queryClient.clear()
    await api()
  })

  const card = page.getByRole('listitem', { name: agent.name, exact: true })
  await card.hover()
  await card.getByRole('button', { name: `More actions for ${agent.name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete agent', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
  const confirm = dialog.getByRole('button', { name: 'Delete agent', exact: true })
  const error = dialog.getByRole('alert')
  await expect
    .element(error)
    .toMatchTextContent('Could not load the impact of deleting this agent.')
  await expect.element(confirm).toBeDisabled()

  await error.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.element(error).not.toBeInTheDocument()
  await expect.element(confirm).toBeEnabled()
  const warning = 'There may be tasks still in progress.'
  await expect.element(dialog).toMatchTextContent(warning)
  expect(dialog.element().textContent?.split(warning)).toHaveLength(2)
  expect(references).toHaveBeenCalledTimes(2)
  expect(api.console.externalAgents.byAgentId.delete).not.toHaveBeenCalled()
})
