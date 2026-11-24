import type { AppPartial, GetAppsResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { AppSelectorValue } from '../index'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { expect, it, vi } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { AppSelector } from '../index'

// App detail routes take UUID ids.
const appId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const apps = [
  {
    id: appId(1),
    name: 'Support Bot',
    mode: 'chat',
    icon_type: 'emoji',
    icon: 'B',
    icon_background: '#FFFFFF',
    icon_url: null,
  },
  {
    id: appId(2),
    name: 'Sales App',
    mode: 'chat',
    icon_type: 'emoji',
    icon: 'S',
    icon_background: '#FFFFFF',
    icon_url: null,
  },
] satisfies AppPartial[]

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

const fake = setupFakeApi(() => ({
  console: {
    apps: {
      get: (input) => ({
        data: apps.filter((app) =>
          app.name.toLowerCase().includes(input?.query?.name?.toLowerCase() ?? ''),
        ),
        page: input?.query?.page ?? 1,
        limit: 20,
        total: 2,
        has_more: false,
      }),
      byAppId: {
        get: ({ params }) =>
          createAppDetailFixture({
            id: params.app_id,
            ...apps.find((app) => app.id === params.app_id),
          }),
      },
    },
    files: { upload: { get: () => createFileUploadConfigFixture() } },
  },
}))

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
  await expect.element(input).toHaveValue('missing')
  await expect.element(page.getByText('common.noData')).toBeVisible()
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
  const supportBot = page.getByRole('option', { name: /Support Bot/ })
  await expect.element(supportBot).toBeVisible()
  await expect.element(supportBot.getByText('B')).toBeVisible()
})

it('removes a highlighted stale result during remote search and selects the new result with the keyboard', async () => {
  const { input, onSelect, onSubmit } = await renderSelector()
  await expect.element(page.getByRole('option', { name: /Support Bot/ })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(input).toHaveAttribute('aria-activedescendant')
  const search = createDeferred<GetAppsResponse>()
  fake.use({
    console: {
      apps: {
        get: (input) =>
          input?.query?.name
            ? search.promise
            : { data: apps, page: 1, limit: 20, total: 2, has_more: false },
      },
    },
  })
  await input.fill('sales')
  await expect.element(page.getByRole('option')).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveValue('sales')
  expect(onSelect).not.toHaveBeenCalled()
  expect(onSubmit).not.toHaveBeenCalled()
  await expect
    .poll(() => fake.console.apps.get)
    .toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ name: 'sales' }) }),
    )
  search.resolve({ data: [apps[1]!], page: 1, limit: 20, total: 1, has_more: false })
  await expect.element(page.getByRole('option', { name: /Sales App/ })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(input).toHaveAttribute('aria-activedescendant')
  await userEvent.keyboard('{Enter}')
  await expect.element(input).not.toBeInTheDocument()
  expect(onSelect).toHaveBeenLastCalledWith({ app_id: appId(2), inputs: {}, files: [] })
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
    id: appId(index + 1),
    name: `Application ${index + 1}`,
  }))
  const nextApp = { ...apps[1]!, id: appId(21), name: 'Application 21' }
  fake.use({
    console: {
      apps: {
        get: (input) => {
          const page = input?.query?.page ?? 1
          return {
            data: page === 1 ? firstPage : [nextApp],
            page,
            limit: 20,
            total: 21,
            has_more: page === 1,
          }
        },
      },
    },
  })
  const { onSelect } = await renderSelector()
  const region = page.getByRole('region', { name: 'app.appSelector.label' })
  await expect.element(region).toBeVisible()
  expect(region.element().scrollHeight).toBeGreaterThan(region.element().clientHeight)
  await page.getByRole('button', { name: 'workflow.common.loadMore' }).click()
  await page.getByRole('option', { name: /Application 21/ }).click()
  expect(onSelect).toHaveBeenLastCalledWith({ app_id: appId(21), inputs: {}, files: [] })
})
