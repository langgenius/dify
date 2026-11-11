import type {
  PersonalAccessTokenDetailResponse,
  PersonalAccessTokenResourceResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { render } from 'vitest-browser-react'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import ScopeDetails from '../scope-details'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: transport }))
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const account = await import('@/i18n/locales/en-US/account-settings.json')
  const common = await import('@/i18n/locales/en-US/common.json')
  const dataset = await import('@/i18n/locales/en-US/dataset.json')
  return createReactI18nextMock({ ...account.default, ...common.default, ...dataset.default })
})

const production: PersonalAccessTokenResourceResponse = {
  resource_type: 'app_deployment',
  resource_id: '019a0000-0000-7000-8000-000000000002',
  parent_app_id: '019a0000-0000-7000-8000-000000000003',
  display_name: 'Assistant / Production',
  workspace_id: '019a0000-0000-7000-8000-000000000004',
  workspace_name: 'Acme',
  available: true,
  reason: null,
}
const staging: PersonalAccessTokenResourceResponse = {
  ...production,
  resource_id: '019a0000-0000-7000-8000-000000000005',
  display_name: 'Assistant / Staging',
}
const builtIn: PersonalAccessTokenResourceResponse = {
  ...production,
  resource_type: 'app',
  resource_id: '019a0000-0000-7000-8000-000000000003',
  parent_app_id: null,
  display_name: 'Assistant',
  app_deployments: [production, staging],
}

it.each([
  {
    name: 'only Built-in is granted',
    resources: [builtIn],
    hasBuiltIn: true,
    hasProduction: false,
  },
  {
    name: 'only Production is granted',
    resources: [production],
    hasBuiltIn: false,
    hasProduction: true,
  },
  {
    name: 'Built-in and Production are granted',
    resources: [builtIn, production],
    hasBuiltIn: true,
    hasProduction: true,
  },
])('shows only the saved grants when $name', async ({ resources, hasBuiltIn, hasProduction }) => {
  const detail: PersonalAccessTokenDetailResponse = {
    token: {
      id: '019a0000-0000-7000-8000-000000000001',
      name: 'release-pipeline',
      secret_last_four: '7f21',
      created_at: '2026-10-15T00:00:00Z',
      expires_at: null,
      last_used_at: null,
      resource_scope_mode: 'selected',
      workspace_scope_mode: 'none',
      resource_count: resources.length,
      workspace_count: 0,
      unavailable_count: 0,
      status: 'active',
      version: 1,
    },
    resources,
    workspaces: [],
  }
  transport.call.mockResolvedValue(detail)
  const queryClient = createTestQueryClient()
  seedSystemFeatures(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Dialog defaultOpen>
        <DialogContent>
          <ScopeDetails tokenId={detail.token.id} />
        </DialogContent>
      </Dialog>
    </QueryClientTestProvider>,
  )
  const table = screen.getByRole('dialog', { name: 'Access scope' }).getByRole('table')
  await expect.element(table).toBeVisible()
  const builtInCell = table.getByRole('cell', { name: 'Acme · Built-in', exact: true })
  const productionCell = table.getByRole('cell', { name: 'Acme · Production', exact: true })
  if (hasBuiltIn) await expect.element(builtInCell).toBeVisible()
  else await expect.element(builtInCell).not.toBeInTheDocument()
  if (hasProduction) {
    await expect.element(productionCell).toBeVisible()
    await expect.element(table.getByText(production.display_name, { exact: true })).toBeVisible()
  } else {
    await expect.element(productionCell).not.toBeInTheDocument()
    await expect
      .element(table.getByText(production.display_name, { exact: true }))
      .not.toBeInTheDocument()
  }
  await expect.element(table.getByText(/Staging/)).not.toBeInTheDocument()
})
