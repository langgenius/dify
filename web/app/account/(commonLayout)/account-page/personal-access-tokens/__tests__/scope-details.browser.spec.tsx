import type {
  PersonalAccessTokenDetailResponse,
  PersonalAccessTokenResourceResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { page } from 'vite-plus/test/browser'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import ScopeDetails from '../scope-details'
import { renderWithTokenMessages as render } from './browser-test-env'

const responses = vi.hoisted(() => ({ call: vi.fn() }))
// boundary: supply operation results while preserving generated options and real Query observers.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withTokenResponses } = await import('./operation-responses')
  return { ...actual, consoleQuery: withTokenResponses(actual.consoleQuery, responses.call) }
})
vi.unmock('react-i18next')

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T00:00:00Z'))
  await page.viewport(1100, 800)
})

afterEach(() => vi.useRealTimers())

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
  responses.call.mockResolvedValue(detail)
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

it('opens saved expired access with workspace roles and unavailable items without offering a secret', async () => {
  const { token, tokenList, renderTokenPage } = await import('./browser-test-env')
  const expired = {
    ...token,
    status: 'expired' as const,
    created_at: '2026-07-01T00:00:00Z',
    expires_at: '2026-09-29T00:00:00Z',
  }
  responses.call.mockImplementation(async (operation: string) =>
    operation.includes('byTokenId')
      ? {
          token: expired,
          resources: [
            { ...builtIn, display_name: 'Customer FAQ Bot', workspace_name: 'Acme' },
            {
              ...builtIn,
              resource_id: staging.resource_id,
              display_name: 'Built-in app',
              workspace_name: "fatelei's Workspace",
              app_deployments: [],
            },
            {
              ...production,
              resource_type: 'dataset',
              display_name: 'Internal Docs',
              available: false,
              reason: 'access_removed',
            },
          ],
          workspaces: [
            {
              workspace_id: production.workspace_id,
              display_name: 'Production',
              role: 'owner',
              available: true,
              reason: null,
            },
            {
              workspace_id: staging.resource_id,
              display_name: 'Missing workspace',
              role: null,
              available: false,
              reason: null,
            },
          ],
        }
      : tokenList([expired]),
  )
  const { screen } = await renderTokenPage()
  const row = screen.getByRole('row', { name: /release-pipeline/ })
  await expect.element(row.getByText('••••7f21')).toBeVisible()
  await expect.element(row.getByText('2026-09-29')).toBeVisible()
  await expect
    .element(row.getByRole('button', { name: 'Copy', exact: true }))
    .not.toBeInTheDocument()
  await row.getByRole('button', { name: token.name }).click()
  const dialog = screen.getByRole('dialog', { name: 'Access scope' })
  await expect.element(dialog.getByText('Expired on 2026-09-29')).toBeVisible()
  await expect.element(dialog.getByText('Created · 2026-07-01')).toBeVisible()
  await expect
    .element(dialog.getByRole('cell', { name: 'Acme · Built-in', exact: true }))
    .toBeVisible()
  await expect
    .element(dialog.getByRole('cell', { name: 'fatelei · Built-in', exact: true }))
    .toBeVisible()
  await expect
    .element(dialog.getByRole('row', { name: /Internal Docs/ }))
    .toMatchTextContent('Deleted')
  await expect.element(dialog.getByRole('row', { name: /Production.*Owner/ })).toBeVisible()
  await expect
    .element(dialog.getByText('2 unavailable items across resources and workspaces'))
    .toBeVisible()
  await expect
    .element(dialog.getByRole('button', { name: 'Copy', exact: true }))
    .not.toBeInTheDocument()
})

it('explains cross-workspace deployment access without labeling it revoked or expired', async () => {
  const { token, tokenList, renderTokenPage } = await import('./browser-test-env')
  const active = {
    ...token,
    status: 'active' as const,
    unavailable_count: 0,
    expires_at: '2027-01-13T00:00:00Z',
  }
  responses.call.mockImplementation(async (operation: string) =>
    operation.includes('byTokenId')
      ? {
          token: active,
          resources: [
            {
              ...production,
              workspace_name: 'Other workspace',
              available: false,
              reason: 'workspace_not_current',
            },
          ],
          workspaces: [],
        }
      : tokenList([active]),
  )
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: token.name }).click()
  const dialog = screen.getByRole('dialog', { name: 'Access scope' })
  await expect.element(dialog.getByText('Switch to this workspace to check access')).toBeVisible()
  await expect.element(dialog.getByText('Deleted', { exact: true })).not.toBeInTheDocument()
  await expect.element(dialog.getByText(/Expired on/)).not.toBeInTheDocument()
})
