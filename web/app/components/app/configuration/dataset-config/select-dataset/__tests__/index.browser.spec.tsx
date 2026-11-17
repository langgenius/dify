import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import SelectDataSet from '../index'

const list = vi.hoisted(() => vi.fn<typeof consoleClient.datasets.get>())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'datasets.get': list }),
  }
})
const dataset = (id: string, overrides: Partial<DatasetDetailWithPartialMembersResponse> = {}) =>
  createDatasetFixture({ id, name: id, embedding_available: true, ...overrides })
const response = (data: ReturnType<typeof dataset>[], page = 1, has_more = false) => ({
  data,
  page,
  limit: 20,
  total: data.length,
  has_more,
})
async function setup({
  selectedIds = [],
  canCreate = true,
  initiallyOpen = true,
}: { selectedIds?: string[]; canCreate?: boolean; initiallyOpen?: boolean } = {}) {
  const { wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: canCreate ? ['dataset.create_and_management'] : [],
  })
  function Caller() {
    const [open, setOpen] = useState(initiallyOpen)
    const [selected, setSelected] = useState<DatasetDetailWithPartialMembersResponse[]>([])
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Select knowledge
        </button>
        <SelectDataSet
          isShow={open}
          selectedIds={selected.length ? selected.map((item) => item.id) : selectedIds}
          onClose={() => setOpen(false)}
          onSelect={(items) => {
            setSelected(items)
            setOpen(false)
          }}
        />
        <ul aria-label="Selected knowledge">
          {selected.map((item) => (
            <li key={item.id}>{item.name}</li>
          ))}
        </ul>
      </>
    )
  }
  return render(
    <Providers>
      <Caller />
    </Providers>,
  )
}
beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  list.mockReset().mockResolvedValue(response([]))
})

it('adds available knowledge through the real selector and leaves unavailable entries disabled', async () => {
  list.mockResolvedValue(
    response([
      dataset('Available'),
      dataset('Unavailable', { embedding_available: false, provider: 'external' }),
    ]),
  )
  const screen = await setup()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByRole('button', { name: /^Unavailable/ })).toBeDisabled()
  await dialog.getByRole('button', { name: /^Available/ }).click()
  await expect.element(dialog.getByText('1 appDebug.feature.dataSet.selected')).toBeVisible()
  await dialog.getByRole('button', { name: 'common.operation.add', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('list', { name: 'Selected knowledge' }).getByRole('listitem'))
    .toHaveTextContent('Available')
})

it.each([true, false])(
  'offers dataset creation only with permission when the result is empty (%s)',
  async (canCreate) => {
    const screen = await setup({ canCreate })
    const dialog = screen.getByRole('dialog')
    await expect.element(dialog.getByText('appDebug.feature.dataSet.noDataSet')).toBeVisible()
    const create = dialog.getByRole('link', { name: 'appDebug.feature.dataSet.toCreate' })
    if (canCreate) await expect.element(create).toHaveAttribute('href', '/datasets/create')
    else await expect.element(create).not.toBeInTheDocument()
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.add', exact: true }))
      .toBeDisabled()
  },
)

it('initializes selection from the caller and cancels an unconfirmed deselection', async () => {
  list.mockResolvedValue(response([dataset('Existing')]))
  const screen = await setup({ selectedIds: ['Existing'] })
  const dialog = screen.getByRole('dialog')
  const count = dialog.getByText('1 appDebug.feature.dataSet.selected')
  await expect.element(count).toBeVisible()
  await dialog.getByRole('button', { name: /^Existing/ }).click()
  await expect.element(count).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Select knowledge' }).click()
  await expect.element(count).toBeVisible()
  await dialog.getByRole('button', { name: 'common.operation.add', exact: true }).click()
  await expect
    .element(screen.getByRole('list', { name: 'Selected knowledge' }).getByRole('listitem'))
    .toHaveTextContent('Existing')
})

it('appends the next page after native scrolling while keeping the first page and one pending request', async () => {
  const next = createDeferred<ReturnType<typeof response>>()
  list
    .mockResolvedValueOnce(
      response(
        Array.from({ length: 20 }, (_, index) => dataset(`Dataset ${index + 1}`)),
        1,
        true,
      ),
    )
    .mockReturnValueOnce(next.promise)
  const screen = await setup()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByRole('button', { name: /^Dataset 20 / })).toBeInTheDocument()
  dialog
    .getByRole('button', { name: /^Dataset 20 / })
    .element()
    .scrollIntoView({ block: 'end' })
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  await expect.element(dialog.getByRole('button', { name: /^Dataset 1 / })).toBeInTheDocument()
  next.resolve(response([dataset('Final dataset')], 2))
  const last = dialog.getByRole('button', { name: /^Final dataset/ })
  await expect.element(last).toBeInTheDocument()
  last.element().scrollIntoView({ block: 'end' })
  await last.click()
  await dialog.getByRole('button', { name: 'common.operation.add', exact: true }).click()
  await expect
    .element(screen.getByRole('list', { name: 'Selected knowledge' }).getByRole('listitem'))
    .toHaveTextContent('Final dataset')
  expect(list).toHaveBeenCalledTimes(2)
})

it('does not request knowledge until the user opens the selector', async () => {
  const screen = await setup({ initiallyOpen: false })
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(list).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'Select knowledge' }).click()
  await expect.element(screen.getByText('appDebug.feature.dataSet.noDataSet')).toBeVisible()
  expect(list).toHaveBeenCalledOnce()
})
