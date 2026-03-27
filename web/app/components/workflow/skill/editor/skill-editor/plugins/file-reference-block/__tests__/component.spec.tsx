import type { AppAssetTreeView } from '@/types/app-asset'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useSelectOrDelete } from '@/app/components/base/prompt-editor/hooks'
import FileReferenceBlock from '../component'

const mockEditor = {
  isEditable: vi.fn(() => true),
  update: vi.fn(),
}

const mockRef = { current: null as HTMLDivElement | null }
const mockNodeMap = new Map<string, AppAssetTreeView>()
const mockWorkflowStoreState = {
  activeTabId: null,
  fileMetadata: new Map(),
}

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}))

vi.mock('@/app/components/base/prompt-editor/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/prompt-editor/hooks')>()
  return {
    ...actual,
    useSelectOrDelete: vi.fn(),
  }
})

vi.mock('@/app/components/workflow/skill/hooks/file-tree/data/use-skill-asset-tree', () => ({
  useSkillAssetNodeMap: () => ({
    data: mockNodeMap,
    isLoading: false,
  }),
  useSkillAssetTreeData: () => ({
    data: { children: [] },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockWorkflowStoreState) => unknown) => selector(mockWorkflowStoreState),
}))

vi.mock('../preview-context', () => ({
  useFilePreviewContext: (selector: (context: { enabled: boolean }) => boolean) => selector({ enabled: false }),
}))

describe('FileReferenceBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEditor.isEditable.mockReturnValue(true)
    mockRef.current = null
    mockNodeMap.clear()
    mockNodeMap.set('file-1', {
      id: 'file-1',
      name: 'contract.pdf',
      path: '/contract.pdf',
      node_type: 'file',
      children: [],
      extension: 'pdf',
      size: 0,
    })
    vi.mocked(useSelectOrDelete).mockReturnValue([mockRef, false])
  })

  // Click-triggered popover should remain visible after opening from the inline file block.
  describe('Picker Popover', () => {
    it('should keep the picker panel visible after pressing the inline file reference', async () => {
      render(
        <FileReferenceBlock
          nodeKey="node-1"
          resourceId="file-1"
        />,
      )

      await act(async () => {
        fireEvent.mouseDown(screen.getByText('contract.pdf'))
      })

      expect(await screen.findByText('workflow.skillEditor.referenceFiles')).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getByText('workflow.skillEditor.referenceFiles')).toBeInTheDocument()
        expect(screen.getByText('workflow.skillSidebar.empty')).toBeInTheDocument()
      })
    })
  })
})
