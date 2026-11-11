import { zModelWithProviderEntityResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createCatalogModelFixture,
  createProviderSummaryFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useExpandModelProviderList } from '../../atoms'
import ProviderAddedCard from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.get': async () => ({
        data: [
          zModelWithProviderEntityResponse.parse({
            ...createCatalogModelFixture(),
            provider: {
              provider: 'langgenius/openai/openai',
              label: { en_US: 'OpenAI' },
              supported_model_types: ['llm'],
              tenant_id: 'tenant-1',
            },
          }),
        ],
      }),
    }),
  }
})
const provider = createProviderSummaryFixture({
  provider: 'langgenius/openai/openai',
  icon_small: { en_US: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
})
function ExpandModels() {
  const expand = useExpandModelProviderList()
  return (
    <button type="button" onClick={() => expand(provider.provider)}>
      Show OpenAI models
    </button>
  )
}

it('restores visible keyboard focus to the grid action after its model list disappears without hovering the card', async () => {
  // The grid action is CSS-hidden outside hover/focus-within; happy-dom cannot prove that native focus reveals it.
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['plugin.plugin_preferences'],
    systemFeatures: { deployment_edition: 'COMMUNITY' },
    features: {},
  })
  seedModelProviderQueries(queryClient)
  const screen = await render(
    <NuqsTestingAdapter>
      <Wrapper>
        <ExpandModels />
        <div style={{ width: 360, marginTop: 40 }}>
          <ProviderAddedCard provider={provider} layout="grid" />
        </div>
      </Wrapper>
    </NuqsTestingAdapter>,
  )
  await screen.getByRole('button', { name: 'Show OpenAI models' }).click()
  await expect.element(screen.getByText('GPT-4')).toBeVisible()
  await userEvent.tab()
  const collapse = screen.getByRole('button', {
    name: /modelProvider.modelProvider.modelsNum/,
    expanded: true,
  })
  await expect.element(collapse).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('GPT-4')).not.toBeInTheDocument()
  const reopen = screen.getByRole('button', { name: /modelProvider.modelProvider.modelsNum/ })
  await expect.element(reopen).toHaveFocus()
  await expect.element(reopen).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('GPT-4')).toBeVisible()
})
