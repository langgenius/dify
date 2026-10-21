import { QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: transport }))
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const account = await import('@/i18n/locales/en-US/account-settings.json')
  const common = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...account.default, ...common.default })
})
it('lets users submit a long selected scope on a short narrow viewport', async () => {
  // Real hit testing and nested scrolling prove that the footer remains reachable;
  // the unit selection tests cannot detect horizontal overflow or obstructed controls.
  await page.viewport(390, 600)
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.includes('personalAccessTokenResources'))
      return {
        data: Array.from({ length: 20 }, (_, index) => ({
          resource_id: `019a0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
          resource_type: 'app',
          display_name: `Assistant ${index + 1}`,
          workspace_id: '019a0000-0000-7000-8000-000000000099',
          workspace_name: 'Production',
          available: true,
          reason: null,
        })),
        next_cursor: null,
        has_more: false,
      }
    if (path.at(-1) === 'post') throw new Error('Service temporarily unavailable')
    return { data: [], page: 1, limit: 20, total: 0, has_more: false }
  })
  const screen = await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <NuqsTestingAdapter>
        <PersonalAccessTokens />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Long selection')
  await dialog
    .getByRole('radiogroup', { name: 'Resources' })
    .getByRole('radio', { name: 'Selected' })
    .click()
  await dialog.getByRole('checkbox', { name: 'Assistant 20' }).click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  expect(
    transport.call.mock.calls.find(([path]) => path.at(-1) === 'post')?.[1].body.resource_scope
      .resources,
  ).toEqual([{ resource_id: '019a0000-0000-7000-8000-000000000019', resource_type: 'app' }])
  await expect.element(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Long selection')
  const bounds = dialog.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(390)
  expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth)
})

it('returns keyboard focus to Create token after deletion removes the trigger row', async () => {
  // The feature's list refresh removes the initiating button before the dialog
  // closes. Verify focus restoration through real portal/close transitions.
  let deleted = false
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.at(-1) === 'delete') {
      deleted = true
      return undefined
    }
    return {
      data: deleted
        ? []
        : [
            {
              id: '019a0000-0000-7000-8000-000000000001',
              name: 'release-pipeline',
              secret_last_four: '7f21',
              created_at: '2026-10-15T00:00:00Z',
              expires_at: null,
              last_used_at: null,
              resource_scope_mode: 'all',
              workspace_scope_mode: 'all',
              resource_count: 0,
              workspace_count: 0,
              unavailable_count: 0,
              status: 'active',
              version: 1,
            },
          ],
      page: 1,
      limit: 20,
      total: deleted ? 0 : 1,
      has_more: false,
    }
  })
  const screen = await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <NuqsTestingAdapter>
        <PersonalAccessTokens />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  await screen.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(screen.getByText('No access tokens yet')).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
})
