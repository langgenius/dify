import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactElement } from 'react'
import { onTestFinished } from 'vite-plus/test'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetCard from '../../index'
import CornerLabels from '../corner-labels'
import OperationsMenu from '../operations-menu'

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

async function renderWithConsole(ui: ReactElement) {
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: true },
    accountProfile: { id: 'user-1', timezone: 'Asia/Shanghai' },
  })
  queryClient.setQueryData(
    consoleQuery.tags.get.queryOptions({ input: { query: { type: 'knowledge' } } }).queryKey,
    [],
  )
  return render(<ConsoleProvider>{ui}</ConsoleProvider>)
}

beforeEach(() => onTestFinished(guardUnexpectedFetch()))

it('keeps operations visible on keyboard focus without covering the unavailable label', async () => {
  // Real CSS and native Tab navigation catch visibility-hidden triggers that happy-dom misses.
  const dataset = createDatasetFixture({
    id: 'dataset-1',
    name: 'Test Dataset',
    runtime_mode: 'general',
    embedding_available: false,
    permission_keys: [DatasetACLPermission.Edit],
  })
  const screen = await renderWithConsole(
    <>
      <button type="button">Before dataset</button>
      <div className="mt-10 w-80">
        <DatasetCard onDelete={vi.fn()} dataset={dataset} />
      </div>
      <button type="button">After dataset</button>
    </>,
  )

  screen.getByRole('button', { name: 'Before dataset' }).element().focus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('link', { name: 'Test Dataset' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('combobox', { name: /^common.tag/ })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect
    .element(screen.getByRole('button', { name: '0 common.datasetMenus.documents' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: '0 dataset.appCount' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  const trigger = screen.getByRole('button', { name: 'common.operation.more' })
  await expect.element(trigger).toHaveFocus()
  await expect.element(trigger).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
    .toBeVisible()
  const unavailableLabel = screen.getByText('dataset.cornerLabel.unavailable')
  await expect.element(unavailableLabel).toBeVisible()
  expect(unavailableLabel.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
    trigger.element().getBoundingClientRect().top,
  )
})

it.each([true, false])(
  'reveals operations on hover, keyboard focus, and while open with embedding available: %s',
  async (embeddingAvailable) => {
    // Real CSS proves hover disclosure and native Tab access, including focus restoration after closing.
    const openRenameModal = vi.fn()
    const dataset = {
      id: 'dataset-1',
      name: 'Test Dataset',
      runtime_mode: 'general',
      embedding_available: embeddingAvailable,
      permission_keys: [DatasetACLPermission.Edit],
    } as DatasetDetailWithPartialMembersResponse
    const screen = await renderWithConsole(
      <>
        <button type="button">Before dataset</button>
        <div role="group" aria-label="Dataset card" className="group relative mt-10 h-40 w-80">
          <CornerLabels dataset={dataset} />
          <OperationsMenu
            dataset={dataset}
            openRenameModal={openRenameModal}
            handleExportPipeline={vi.fn()}
            onDelete={vi.fn()}
            openAccessConfig={vi.fn()}
          />
        </div>
        <button type="button">After dataset</button>
      </>,
    )

    const before = screen.getByRole('button', { name: 'Before dataset' })
    const trigger = screen.getByRole('button', { name: 'common.operation.more' })
    const isTriggerVisible = () => trigger.element().checkVisibility({ opacityProperty: true })
    await userEvent.hover(before)
    before.element().focus()
    await expect.poll(isTriggerVisible).toBe(false)
    await userEvent.hover(screen.getByRole('group', { name: 'Dataset card' }))
    await expect.poll(isTriggerVisible).toBe(true)
    await userEvent.hover(before)
    await expect.poll(isTriggerVisible).toBe(false)
    await userEvent.keyboard('{Tab}')
    await expect.poll(isTriggerVisible).toBe(true)
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toBeVisible()
    if (!embeddingAvailable) {
      const unavailableLabel = screen.getByText('dataset.cornerLabel.unavailable')
      await expect.element(unavailableLabel).toBeVisible()
      expect(unavailableLabel.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
        trigger.element().getBoundingClientRect().top,
      )
    }
    await userEvent.keyboard('{Enter}')
    const edit = screen.getByRole('menuitem', { name: 'common.operation.edit' })
    await expect.element(edit).toHaveFocus()
    await expect.poll(isTriggerVisible).toBe(true)
    await userEvent.keyboard('{Enter}')
    expect(openRenameModal).toHaveBeenCalledTimes(1)
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.poll(isTriggerVisible).toBe(true)
    await userEvent.keyboard('{Tab}')
    await expect.element(screen.getByRole('button', { name: 'After dataset' })).toHaveFocus()
    await expect.poll(isTriggerVisible).toBe(false)
  },
)
