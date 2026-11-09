import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DataSourceType } from '@/models/datasets'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import DocumentTableRow from '../document-table-row'

const mockPush = vi.fn()
let mockSearchParams = ''

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => new URLSearchParams(mockSearchParams),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (value: { dataset: { permission_keys: string[] } }) => unknown,
  ) => selector({ dataset: { permission_keys: ['dataset.acl.edit'] } }),
}))

const createWrapper = (value: string[] = [], onValueChange = vi.fn()) => {
  const { wrapper: QueryClientWrapper } = createConsoleQueryWrapper()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientWrapper>
      <CheckboxGroup
        value={value}
        onValueChange={(nextValue) => onValueChange(nextValue)}
        allValues={['doc-1']}
      >
        <table>
          <tbody>{children}</tbody>
        </table>
      </CheckboxGroup>
    </QueryClientWrapper>
  )
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

const getRowCheckbox = () => screen.getByRole('checkbox', { name: 'test-document.txt' })

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('DocumentTableRow', () => {
  const defaultProps = {
    doc: createMockDoc(),
    index: 0,
    datasetId: 'dataset-1',
    isGeneralMode: true,
    isQAMode: false,
    embeddingAvailable: true,
    onShowRenameModal: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = ''
  })

  describe('Row Navigation', () => {
    it('provides a keyboard-accessible detail link preserving search parameters', async () => {
      const user = userEvent.setup()
      mockSearchParams = 'page=2&status=error'
      render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })

      const link = screen.getByRole('link', { name: 'test-document.txt' })
      expect(link).toHaveAttribute(
        'href',
        '/datasets/dataset-1/documents/doc-1?page=2&status=error',
      )
      await user.tab()
      expect(getRowCheckbox()).toHaveFocus()
      await user.tab()
      expect(link).toHaveFocus()
      await user.keyboard('{Control>}')
      await user.click(link)
      await user.keyboard('{/Control}')
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should preserve search params when navigating to detail', async () => {
      const user = userEvent.setup()
      mockSearchParams = 'page=2&status=error'
      render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })

      await user.click(screen.getByRole('row'))

      expect(mockPush).toHaveBeenCalledWith(
        '/datasets/dataset-1/documents/doc-1?page=2&status=error',
      )
    })
  })

  describe('Rename Action', () => {
    it('exposes a named rename action that can be activated with the keyboard', async () => {
      const user = userEvent.setup()
      const onShowRenameModal = vi.fn()
      render(<DocumentTableRow {...defaultProps} onShowRenameModal={onShowRenameModal} />, {
        wrapper: createWrapper(),
      })

      await user.tab()
      await user.tab()
      await user.tab()
      expect(
        screen.getByRole('button', { name: 'datasetDocuments.list.table.rename' }),
      ).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(onShowRenameModal).toHaveBeenCalledWith(defaultProps.doc)
      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  it('selects a row without triggering detail navigation', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper([], onValueChange) })
    await user.click(getRowCheckbox())
    expect(onValueChange).toHaveBeenCalledWith(['doc-1'])
    expect(mockPush).not.toHaveBeenCalled()
  })
})
