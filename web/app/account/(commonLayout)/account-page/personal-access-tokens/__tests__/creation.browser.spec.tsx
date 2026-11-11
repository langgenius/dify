import type {
  PersonalAccessTokenCreatedResponse,
  PersonalAccessTokenListResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'
import { render, renderTokens, token } from './browser-test-env'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: transport }))
vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(1100, 800)
})

it.each(['create', 'duplicate'] as const)(
  'keeps the %s dialog open during submission and displays the one-time secret',
  async (entry) => {
    let resolveCreation!: (value: PersonalAccessTokenCreatedResponse) => void
    const creation = new Promise<PersonalAccessTokenCreatedResponse>((resolve) => {
      resolveCreation = resolve
    })
    const previousRows =
      entry === 'duplicate'
        ? [
            ...Array.from({ length: 19 }, (_, index) => ({
              ...token,
              id: `019a0000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
              name: `Other token ${index + 1}`,
            })),
            token,
          ]
        : []
    const createdToken = {
      ...token,
      id: '019a0000-0000-7000-8000-000000000999',
      name: 'Pending creation',
    }
    let created = false
    transport.call.mockImplementation(async (path: string[]) => {
      if (path.at(-1) === 'post') {
        const result = await creation
        created = true
        return result
      }
      if (path.includes('byTokenId')) return { token, resources: [], workspaces: [] }
      return {
        data: created ? [createdToken, ...previousRows].slice(0, 20) : previousRows,
        page: 1,
        limit: 20,
        total: previousRows.length + Number(created),
        has_more: previousRows.length + Number(created) > 20,
      }
    })
    const queryClient = createTestQueryClient()
    seedSystemFeatures(queryClient)
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <NuqsTestingAdapter>
          <PersonalAccessTokens />
        </NuqsTestingAdapter>
      </QueryClientTestProvider>,
    )
    if (entry === 'create') await screen.getByRole('button', { name: 'Create token' }).click()
    else
      await screen
        .getByRole('row', { name: /Page two token/ })
        .getByRole('button', { name: 'Duplicate', exact: true })
        .click()
    const dialog = screen.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Pending creation')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.element(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await expect.element(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).toBeVisible()
    await userEvent.click(document.body, { position: { x: 4, y: 4 } })
    await expect.element(dialog).toBeVisible()
    resolveCreation({ ...createdToken, secret: 'dpat_fixture_secret' })
    await expect
      .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
      .toHaveValue('dpat_fixture_secret')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    if (entry === 'duplicate')
      await expect
        .element(screen.getByRole('row', { name: /Page two token/ }))
        .not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
  },
)

it.each(['create', 'duplicate'] as const)(
  'shows the secret immediately after %s succeeds while the token list is still refreshing',
  async (entry) => {
    const refresh = createDeferred<PersonalAccessTokenListResponse>()
    const createdToken = { ...token, id: '019a0000-0000-7000-8000-000000000999', name: 'New token' }
    let created = false
    let reads = 0
    transport.call.mockImplementation(async (path: string[]) => {
      if (path.at(-1) === 'post') {
        created = true
        return { ...createdToken, secret: 'dpat_fixture_secret' }
      }
      if (path.includes('byTokenId')) return { token, resources: [], workspaces: [] }
      reads += 1
      if (created) return refresh.promise
      return {
        data: entry === 'create' ? [] : [token],
        page: 1,
        limit: 20,
        total: entry === 'create' ? 0 : 1,
        has_more: false,
      }
    })
    const screen = await renderTokens()
    if (entry === 'create') await screen.getByRole('button', { name: 'Create token' }).click()
    else await screen.getByRole('button', { name: 'Duplicate', exact: true }).click()
    const dialog = screen.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name' }).fill(createdToken.name)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await vi.waitFor(() => expect(reads).toBe(2))
    await expect
      .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
      .toHaveValue('dpat_fixture_secret')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
    refresh.resolve({ data: [createdToken], page: 1, limit: 20, total: 1, has_more: false })
    await expect
      .element(screen.getByRole('button', { name: createdToken.name, exact: true }))
      .toBeVisible()
  },
)
