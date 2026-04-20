import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { CreateSnippetDialogPayload } from '@/app/components/workflow/create-snippet-dialog'
import type { SnippetDetail } from '@/models/snippet'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import SnippetInfoDropdown from '../dropdown'

const mockReplace = vi.fn()
const mockDownloadBlob = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockUpdateMutate = vi.fn()
const mockExportMutateAsync = vi.fn()
const mockDeleteMutate = vi.fn()
let mockDropdownOpen = false
let mockDropdownOnOpenChange: ((open: boolean) => void) | undefined

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (args: { data: Blob, fileName: string }) => mockDownloadBlob(args),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@langgenius/dify-ui/dropdown-menu', () => ({
  DropdownMenu: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
  }) => {
    mockDropdownOpen = !!open
    mockDropdownOnOpenChange = onOpenChange
    return <div>{children}</div>
  },
  DropdownMenuTrigger: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <button
      type="button"
      className={className}
      onClick={() => mockDropdownOnOpenChange?.(!mockDropdownOpen)}
    >
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    mockDropdownOpen ? <div>{children}</div> : null
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}))

vi.mock('@/service/use-snippets', () => ({
  useUpdateSnippetMutation: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),
  useExportSnippetMutation: () => ({
    mutateAsync: mockExportMutateAsync,
    isPending: false,
  }),
  useDeleteSnippetMutation: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
}))

type MockCreateSnippetDialogProps = {
  isOpen: boolean
  title?: string
  confirmText?: string
  initialValue?: {
    name?: string
    description?: string
    icon?: AppIconSelection
  }
  onClose: () => void
  onConfirm: (payload: CreateSnippetDialogPayload) => void
}

vi.mock('@/app/components/workflow/create-snippet-dialog', () => ({
  default: ({
    isOpen,
    title,
    confirmText,
    initialValue,
    onClose,
    onConfirm,
  }: MockCreateSnippetDialogProps) => {
    if (!isOpen)
      return null

    return (
      <div data-testid="create-snippet-dialog">
        <div>{title}</div>
        <div>{confirmText}</div>
        <div>{initialValue?.name}</div>
        <div>{initialValue?.description}</div>
        <button
          type="button"
          onClick={() => onConfirm({
            name: 'Updated snippet',
            description: 'Updated description',
            icon: {
              type: 'emoji',
              icon: '✨',
              background: '#FFFFFF',
            },
            graph: {
              nodes: [],
              edges: [],
              viewport: { x: 0, y: 0, zoom: 1 },
            },
          })}
        >
          submit-edit
        </button>
        <button type="button" onClick={onClose}>close-edit</button>
      </div>
    )
  },
}))

const mockSnippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Social Media Repurposer',
  description: 'Turn one blog post into multiple social media variations.',
  author: 'Dify',
  updatedAt: '2026-03-25 10:00',
  usage: '12',
  icon: '🤖',
  iconBackground: '#F0FDF9',
  status: undefined,
}

describe('SnippetInfoDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDropdownOpen = false
    mockDropdownOnOpenChange = undefined
  })

  // Rendering coverage for the menu trigger itself.
  describe('Rendering', () => {
    it('should render the dropdown trigger button', () => {
      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  // Edit flow should seed the dialog with current snippet info and submit updates.
  describe('Edit Snippet', () => {
    it('should open the edit dialog and submit snippet updates', async () => {
      const user = userEvent.setup()
      mockUpdateMutate.mockImplementation((_variables: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      })

      render(<SnippetInfoDropdown snippet={mockSnippet} />)
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('snippet.menu.editInfo'))

      expect(screen.getByTestId('create-snippet-dialog')).toBeInTheDocument()
      expect(screen.getByText('snippet.editDialogTitle')).toBeInTheDocument()
      expect(screen.getByText('common.operation.save')).toBeInTheDocument()
      expect(screen.getByText(mockSnippet.name)).toBeInTheDocument()
      expect(screen.getByText(mockSnippet.description)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'submit-edit' }))

      expect(mockUpdateMutate).toHaveBeenCalledWith({
        params: { snippetId: mockSnippet.id },
        body: {
          name: 'Updated snippet',
          description: 'Updated description',
          icon_info: {
            icon: '✨',
            icon_type: 'emoji',
            icon_background: '#FFFFFF',
            icon_url: undefined,
          },
        },
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }))
      expect(mockToastSuccess).toHaveBeenCalledWith('snippet.editDone')
    })
  })

  // Export should call the export hook and download the returned YAML blob.
  describe('Export Snippet', () => {
    it('should export and download the snippet yaml', async () => {
      const user = userEvent.setup()
      mockExportMutateAsync.mockResolvedValue('yaml: content')

      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('snippet.menu.exportSnippet'))

      await waitFor(() => {
        expect(mockExportMutateAsync).toHaveBeenCalledWith({ snippetId: mockSnippet.id })
      })

      expect(mockDownloadBlob).toHaveBeenCalledWith({
        data: expect.any(Blob),
        fileName: `${mockSnippet.name}.yml`,
      })
    })

    it('should show an error toast when export fails', async () => {
      const user = userEvent.setup()
      mockExportMutateAsync.mockRejectedValue(new Error('export failed'))

      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('snippet.menu.exportSnippet'))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('snippet.exportFailed')
      })
    })
  })

  // Delete should require confirmation and redirect after a successful mutation.
  describe('Delete Snippet', () => {
    it('should confirm deletion and redirect to the snippets list', async () => {
      const user = userEvent.setup()
      mockDeleteMutate.mockImplementation((_variables: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      })

      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('snippet.menu.deleteSnippet'))

      expect(screen.getByText('snippet.deleteConfirmTitle')).toBeInTheDocument()
      expect(screen.getByText('snippet.deleteConfirmContent')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      expect(mockDeleteMutate).toHaveBeenCalledWith({
        params: { snippetId: mockSnippet.id },
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }))
      expect(mockToastSuccess).toHaveBeenCalledWith('snippet.deleted')
      expect(mockReplace).toHaveBeenCalledWith('/snippets')
    })
  })
})
