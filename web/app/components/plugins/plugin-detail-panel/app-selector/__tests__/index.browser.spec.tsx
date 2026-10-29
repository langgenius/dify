import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { AppSelectorValue } from '../index'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppSelector } from '../index'

const apps = [
  {
    id: 'app-1',
    name: 'Support Bot',
    mode: 'chat',
    icon_type: 'emoji',
    icon: 'B',
    icon_background: '#FFFFFF',
    icon_url: null,
  },
  {
    id: 'app-2',
    name: 'Sales App',
    mode: 'chat',
    icon_type: 'emoji',
    icon: 'S',
    icon_background: '#FFFFFF',
    icon_url: null,
  },
] satisfies AppPartial[]
const { fetchApps, fetchApp } = vi.hoisted(() => ({ fetchApps: vi.fn(), fetchApp: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': fetchApps,
      'apps.byAppId.get': fetchApp,
      'files.upload.get': () => ({}),
    }),
  }
})
vi.mock('@/app/components/base/app-icon', () => ({ default: () => null }))

function Harness({
  onSelect,
  onSubmit,
}: {
  onSelect: (value: AppSelectorValue) => void
  onSubmit: () => void
}) {
  const [value, setValue] = useState<AppSelectorValue>()
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <AppSelector
        value={value}
        onSelect={(nextValue) => {
          setValue(nextValue)
          onSelect(nextValue)
        }}
      />
      <button type="submit">Save</button>
    </form>
  )
}

async function renderSelector() {
  const onSelect = vi.fn()
  const onSubmit = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={client}>
      <Harness onSelect={onSelect} onSubmit={onSubmit} />
    </QueryClientProvider>,
  )
  await page.getByRole('button', { name: 'app.appSelector.placeholder' }).click()
  await page.getByRole('button', { name: 'app.appSelector.placeholder' }).nth(1).click()
  const input = page.getByRole('combobox', { name: 'app.appSelector.searchPlaceholder' })
  await expect.element(input).toHaveFocus()
  return { input, onSelect, onSubmit }
}

beforeEach(() => {
  fetchApps.mockImplementation(({ query }: { query: { name: string; page: number } }) => ({
    data: apps.filter((app) => app.name.toLowerCase().includes(query.name.toLowerCase())),
    page: query.page,
    has_more: false,
  }))
  fetchApp.mockImplementation(({ params }: { params: { app_id: string } }) =>
    createAppDetailFixture(apps.find((app) => app.id === params.app_id)),
  )
})

it('dismisses only the inner picker with Escape and starts a fresh search after either popover closes', async () => {
  const { input, onSubmit } = await renderSelector()
  await input.fill('sales')
  await expect.element(page.getByRole('option', { name: /Sales App/ })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(input).not.toBeInTheDocument()
  const innerTrigger = page.getByRole('button', { name: 'app.appSelector.placeholder' }).nth(1)
  await expect.element(innerTrigger).toHaveFocus()
  await innerTrigger.click()
  await expect.element(input).toHaveValue('')
  await input.fill('missing')
  await expect.element(page.getByText('common.noData')).toBeVisible()
  await userEvent.keyboard('{Enter}')
  expect(onSubmit).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await expect.element(input).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('button', { name: 'app.appSelector.placeholder' }))
    .toHaveFocus()
  await page.getByRole('button', { name: 'app.appSelector.placeholder' }).click()
  await page.getByRole('button', { name: 'app.appSelector.placeholder' }).nth(1).click()
  await expect.element(input).toHaveValue('')
  await expect.element(page.getByRole('option', { name: /Support Bot/ })).toBeVisible()
})

it('removes a highlighted stale result during remote search and selects the new result with the keyboard', async () => {
  const { input, onSelect, onSubmit } = await renderSelector()
  await expect.element(page.getByRole('option', { name: /Support Bot/ })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(input).toHaveAttribute('aria-activedescendant')
  let resolveSearch!: (value: { data: AppPartial[]; page: number; has_more: boolean }) => void
  fetchApps.mockImplementation(({ query }: { query: { name: string } }) =>
    query.name
      ? new Promise((resolve) => {
          resolveSearch = resolve
        })
      : { data: apps, page: 1, has_more: false },
  )
  await input.fill('sales')
  await expect.element(page.getByRole('option')).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  expect(onSelect).not.toHaveBeenCalled()
  expect(onSubmit).not.toHaveBeenCalled()
  await expect.poll(() => resolveSearch).toBeTypeOf('function')
  resolveSearch({ data: [apps[1]!], page: 1, has_more: false })
  await expect.element(page.getByRole('option', { name: /Sales App/ })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(input).toHaveAttribute('aria-activedescendant')
  await userEvent.keyboard('{Enter}')
  await expect.element(input).not.toBeInTheDocument()
  expect(onSelect).toHaveBeenLastCalledWith({ app_id: 'app-2', inputs: {}, files: [] })
  expect(onSubmit).not.toHaveBeenCalled()
  const innerTrigger = page.getByRole('button', { name: 'Sales App' }).nth(1)
  await expect.element(innerTrigger).toHaveFocus()
  await innerTrigger.click()
  await expect.element(input).toHaveValue('')
  await expect
    .element(page.getByRole('option', { name: /Sales App/ }))
    .toHaveAttribute('aria-selected', 'true')
})

it('keeps pagination reachable in the scroll area and selects an app from the appended page', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({
    ...apps[0]!,
    id: `app-${index + 1}`,
    name: `Application ${index + 1}`,
  }))
  const nextApp = { ...apps[1]!, id: 'app-21', name: 'Application 21' }
  fetchApps.mockImplementation(({ query }: { query: { page: number } }) => ({
    data: query.page === 1 ? firstPage : [nextApp],
    page: query.page,
    has_more: query.page === 1,
  }))
  const { onSelect } = await renderSelector()
  const region = page.getByRole('region', { name: 'app.appSelector.label' })
  await expect.element(region).toBeVisible()
  expect(region.element().scrollHeight).toBeGreaterThan(region.element().clientHeight)
  await page.getByRole('button', { name: 'workflow.common.loadMore' }).click()
  await page.getByRole('option', { name: /Application 21/ }).click()
  expect(onSelect).toHaveBeenLastCalledWith({ app_id: 'app-21', inputs: {}, files: [] })
})
