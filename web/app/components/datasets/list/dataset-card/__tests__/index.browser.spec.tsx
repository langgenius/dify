import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetCard from '../index'

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const centerOf = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return [rect.left + rect.width / 2, rect.top + rect.height / 2] as const
}

it('makes the whole card the entry while footer details and tags stay separate controls', async () => {
  // Real layout proves the stretched entry, the unclipped card focus, and the pointer targets of
  // controls positioned above it.
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1', timezone: 'Asia/Shanghai' },
    systemFeatures: { rbac_enabled: true },
  })
  queryClient.setQueryData(
    consoleQuery.tags.get.queryOptions({ input: { query: { type: 'knowledge' } } }).queryKey,
    [],
  )
  const screen = await render(
    <Providers>
      <button type="button">Before dataset</button>
      <ul className="mt-4 grid w-80 p-4">
        <DatasetCard
          onDelete={vi.fn()}
          dataset={createDatasetFixture({
            permission_keys: [DatasetACLPermission.Edit],
            document_count: 3,
          })}
        />
      </ul>
    </Providers>,
  )

  const link = screen.getByRole('link', { name: 'Test Dataset' })
  const card = link.element().closest('li')!
  screen.getByRole('button', { name: 'Before dataset' }).element().focus()
  await userEvent.keyboard('{Tab}')
  await expect.element(link).toHaveFocus()
  await expect.poll(() => getComputedStyle(card, '::after').boxShadow).toContain('inset')

  await userEvent.keyboard('{Tab}')
  const tags = screen.getByRole('combobox', { name: /^common.tag/ })
  await expect.element(tags).toHaveFocus()
  expect(getComputedStyle(card, '::after').boxShadow).toBe('none')

  const documents = screen.getByRole('button', { name: /common.datasetMenus.documents$/ })
  for (const control of [tags.element(), documents.element()]) {
    const target = document.elementFromPoint(...centerOf(control))
    expect(control.contains(target)).toBe(true)
    expect(target?.closest('a')).toBeNull()
  }
  const updated = screen.getByText(/^dataset.updated /).element()
  expect(document.elementFromPoint(...centerOf(updated))?.closest('a')).toBe(link.element())

  await userEvent.click(documents)
  await expect
    .element(screen.getByRole('dialog', { name: 'common.datasetMenus.documents' }))
    .toBeVisible()
})

it('returns focus after renaming is cancelled and resets the draft on reopening', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1' },
    systemFeatures: { rbac_enabled: true },
  })
  queryClient.setQueryData(
    consoleQuery.tags.get.queryOptions({ input: { query: { type: 'knowledge' } } }).queryKey,
    [],
  )
  const screen = await render(
    <Providers>
      <ul className="grid w-80 p-4">
        <DatasetCard
          onDelete={vi.fn()}
          dataset={createDatasetFixture({ permission_keys: [DatasetACLPermission.Edit] })}
        />
      </ul>
    </Providers>,
  )
  const trigger = screen.getByRole('button', { name: 'common.operation.more' })
  const open = async () => {
    await screen.getByRole('link', { name: 'Test Dataset' }).hover()
    await trigger.click()
    await screen.getByRole('menuitem', { name: 'common.operation.edit', exact: true }).click()
    await expect
      .element(screen.getByRole('dialog', { name: 'datasetSettings.title' }))
      .toBeVisible()
  }
  await open()
  const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name', exact: true })
  await name.fill('Unsaved draft')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await open()
  await expect.element(name).toHaveValue('Test Dataset')
})

afterEach(() => vi.unstubAllGlobals())
