import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { DocumentToRename } from '../../../rename-document-form'
import type { TestNavigation } from '@/test/next-navigation'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DatasetDetailContext from '@/context/dataset-detail'
import { DataSourceType } from '@/models/datasets'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createTestNavigation } from '@/test/next-navigation'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import DocumentTableRow from '../document-table-row'

let search = ''
let navigation: TestNavigation

const createWrapper = () => {
  const { wrapper: QueryClientWrapper } = createConsoleQueryWrapper({
    currentWorkspace: { id: 'workspace-1' },
    workspacePermissionKeys: [],
  })
  navigation = createTestNavigation({ url: `/datasets/dataset-1/documents?${search}` })
  const { NavigationProvider } = navigation
  return function Wrapper({ children }: { children: ReactNode }) {
    const [selected, setSelected] = useState<string[]>([])
    return (
      <NavigationProvider>
        <QueryClientWrapper>
          {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component. */}
          <DatasetDetailContext.Provider
            value={{ dataset: createDatasetFixture({ permission_keys: ['dataset.acl.edit'] }) }}
          >
            <CheckboxGroup value={selected} onValueChange={setSelected} allValues={['doc-1']}>
              <table>
                <tbody>{children}</tbody>
              </table>
            </CheckboxGroup>
          </DatasetDetailContext.Provider>
        </QueryClientWrapper>
      </NavigationProvider>
    )
  }
}

type LocalDoc = DocumentWithSegmentsResponse & { percent?: number }

const createMockDoc = (overrides: Partial<LocalDoc> = {}): LocalDoc => ({
  id: 'doc-1',
  name: 'test-document.txt',
  data_source_type: DataSourceType.FILE,
  indexing_status: 'completed',
  display_status: 'available',
  enabled: true,
  archived: false,
  created_at: 1700000000,
  data_source_detail_dict: {
    upload_file: {
      id: 'file-1',
      name: 'test.txt',
      extension: 'txt',
      mime_type: 'text/plain',
      size: 1024,
      created_at: 1700000000,
      created_by: 'user-1',
    },
  },
  ...overrides,
})

const getRowCheckbox = () => page.getByRole('checkbox', { name: 'test-document.txt' })

describe('DocumentTableRow', () => {
  const defaultProps = {
    doc: createMockDoc(),
    index: 0,
    datasetId: 'dataset-1',
    isGeneralMode: true,
    isQAMode: false,
    embeddingAvailable: true,
    renameDialog: createDialogHandle<DocumentToRename>(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    search = ''
  })

  describe('Row Navigation', () => {
    it('provides a keyboard-accessible detail link preserving search parameters', async () => {
      search = 'page=2&status=error'
      await render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })

      const link = page.getByRole('link', { name: 'test-document.txt' })
      await expect
        .element(link)
        .toHaveAttribute('href', '/datasets/dataset-1/documents/doc-1?page=2&status=error')
      await userEvent.tab()
      await expect.element(getRowCheckbox()).toHaveFocus()
      await userEvent.tab()
      await expect.element(link).toHaveFocus()
      await userEvent.keyboard('{Control>}')
      await link.click()
      await userEvent.keyboard('{/Control}')
      expect(navigation.router.push).not.toHaveBeenCalled()
    })

    it('preserves the current list filters when the row opens document details', async () => {
      search = 'page=2&status=error'
      await render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })

      await page.getByRole('row').click()

      expect(navigation.router.push).toHaveBeenCalledWith(
        '/datasets/dataset-1/documents/doc-1?page=2&status=error',
      )
    })
  })

  it('explains why a document failed from the list, without opening the document', async () => {
    const reason =
      '"test-document.txt" was blocked by the malware scan: Evil.A detected. The original file was deleted.'
    await render(
      <DocumentTableRow
        {...defaultProps}
        doc={createMockDoc({ indexing_status: 'error', display_status: 'error', error: reason })}
      />,
      { wrapper: createWrapper() },
    )

    await expect.element(page.getByText(reason)).not.toBeInTheDocument()
    await page.getByRole('button', { name: /error/i }).click()

    await expect.element(page.getByText(reason)).toBeVisible()
    expect(navigation.router.push).not.toHaveBeenCalled()
  })

  it('toggles row selection without navigating to document details', async () => {
    await render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })
    await getRowCheckbox().click()
    await expect.element(getRowCheckbox()).toBeChecked()
    expect(navigation.router.push).not.toHaveBeenCalled()
    await userEvent.keyboard('{Space}')
    await expect.element(getRowCheckbox()).not.toBeChecked()
    expect(navigation.router.push).not.toHaveBeenCalled()
  })
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
