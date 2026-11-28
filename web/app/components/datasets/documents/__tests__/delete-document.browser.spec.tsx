import { zDocumentWithSegmentsListResponse } from '@dify/contracts/api/console/datasets/zod.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DatasetDetailContext from '@/context/dataset-detail'
import { emulateReducedMotion } from '@/test/browser-media-emulation'
import { TEST_DATASET_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createTestNavigation } from '@/test/next-navigation'
import { DatasetACLPermission } from '@/utils/permission'
import Documents from '../index'

beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())
async function setup(ids: string[]) {
  let datasets = zDocumentWithSegmentsListResponse.parse({
    data: ids.map((id, index) => ({
      id,
      name: id,
      position: index + 1,
      data_source_type: 'upload_file',
      indexing_status: 'completed',
      enabled: true,
      archived: false,
      display_status: 'available',
      created_at: 1700000000,
      doc_form: 'text_model',
      data_source_detail_dict: {},
    })),
    total: ids.length,
    page: 1,
    limit: 10,
    has_more: false,
  }).data
  const fake = installFakeApi({
    console: {
      datasets: {
        byDatasetId: {
          documents: {
            get: async () => ({
              data: datasets,
              page: 1,
              total: datasets.length,
              limit: 30,
              has_more: false,
            }),
            delete: async ({ query }) => {
              datasets = datasets.filter((item) => !query?.document_id?.includes(item.id))
            },
          },
          metadata: { get: () => ({ doc_metadata: [], built_in_field_enabled: false }) },
          autoDisableLogs: { get: () => ({ document_ids: [], count: 0 }) },
          errorDocs: { get: () => ({ data: [], total: 0 }) },
        },
        metadata: { builtIn: { get: () => ({ fields: [] }) } },
      },
      tags: { get: () => [] },
    },
  })
  onTestFinished(fake)
  const { queryClient } = createConsoleQueryWrapper({ systemFeatures: { rbac_enabled: true } })
  const { NavigationProvider } = createTestNavigation({
    url: `/datasets/${TEST_DATASET_ID}/documents`,
    params: { datasetId: TEST_DATASET_ID },
  })
  const screen = await render(
    <NavigationProvider>
      <QueryClientTestProvider queryClient={queryClient}>
        <NuqsTestingAdapter hasMemory>
          {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component. */}
          <DatasetDetailContext.Provider
            value={{
              dataset: createDatasetFixture({
                embedding_available: true,
                permission_keys: [
                  DatasetACLPermission.Use,
                  DatasetACLPermission.Edit,
                  DatasetACLPermission.DeleteFile,
                ],
              }),
            }}
          >
            <div className="isolate h-screen">
              <Documents datasetId={TEST_DATASET_ID} />
            </div>
          </DatasetDetailContext.Provider>
        </NuqsTestingAdapter>
      </QueryClientTestProvider>
    </NavigationProvider>,
  )
  const open = async (id: string) => {
    const link = screen.getByRole('link', { name: id, exact: true })
    await link.hover()
    const card = link.element().closest('tr')!
    await userEvent.click(card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    await screen
      .getByRole('menuitem', { name: 'datasetDocuments.list.action.delete', exact: true })
      .click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  }
  return { screen, open, fake }
}
describe('Classic document deletion', () => {
  it('removes the item before a slow list refresh completes', async () => {
    const { screen, open, fake } = await setup(['Alpha', 'Beta'])
    await open('Alpha')
    const refresh = hold(fake.console.datasets.byDatasetId.documents.get)
    await screen.getByRole('button', { name: 'common.operation.sure' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Alpha', exact: true }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Beta', exact: true })).toHaveFocus()
    refresh.release()
  })

  it.each([
    { ids: ['Alpha', 'Beta', 'Gamma'], remove: 'Beta', next: 'Gamma' },
    { ids: ['Alpha', 'Beta'], remove: 'Beta', next: 'Alpha' },
    { ids: ['Alpha'], remove: 'Alpha', next: null },
  ])('restores focus after deleting $remove from $ids', async ({ ids, remove, next }) => {
    const { screen, open } = await setup(ids)
    await open(remove)
    await screen.getByRole('button', { name: 'common.operation.sure' }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: remove, exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(
        next ? screen.getByRole('link', { name: next, exact: true }) : screen.getByRole('region'),
      )
      .toHaveFocus()
  })
  it('retains focus while pending and leaves a failed deletion retryable', async () => {
    const { screen, open, fake } = await setup(['Alpha'])
    const request = hold(fake.console.datasets.byDatasetId.documents.delete)
    await open('Alpha')
    const confirm = screen.getByRole('button', { name: 'common.operation.sure' })
    await confirm.click()
    await expect.element(confirm).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.cancel' }))
      .toBeDisabled()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    request.reject(apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Failed' }))
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('common.actionMsg.modifiedUnsuccessfully')
    await confirm.click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('region')).toHaveFocus()
  })
})

it.each(['pencil', 'menu'])(
  'returns focus to the selected row after cancelling rename from its %s entry',
  async (entry) => {
    // The exit transition is where the draft must survive.
    await emulateReducedMotion(false)
    const { screen } = await setup(['Alpha', 'Beta'])
    const row = screen.getByRole('row', { name: /Beta/ })
    await row.getByRole('link', { name: 'Beta' }).hover()
    const rename = 'datasetDocuments.list.table.rename'
    const trigger = row.getByRole('button', {
      name: entry === 'pencil' ? rename : 'common.operation.more',
    })
    if (entry === 'pencil') {
      row.getByRole('link', { name: 'Beta' }).element().focus()
      await userEvent.tab()
      await expect.element(trigger).toHaveFocus()
      await userEvent.keyboard('{Enter}')
    } else {
      await trigger.click()
      await screen.getByRole('menuitem', { name: rename }).click()
    }
    const dialog = screen.getByRole('dialog', { name: rename })
    const textbox = dialog.getByRole('textbox')
    await expect.element(textbox).toHaveValue('Beta')
    const expectedName = entry === 'pencil' ? 'Unsubmitted draft' : 'Beta'
    if (entry === 'pencil') await textbox.fill(expectedName)

    const popup = dialog.element()
    const input = textbox.element() as HTMLInputElement
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
    const exitingName = vi.fn()
    popup.addEventListener('transitionstart', (event) => {
      if (event.target === popup && popup.hasAttribute('data-ending-style'))
        exitingName(input.value)
    })
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => exitingName.mock.calls.flat()).toContain(expectedName)
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)
