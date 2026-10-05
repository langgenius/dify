import type { SnippetDetail } from '@/models/snippet'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { render } from '@/test/console/render'
import SnippetInfoDropdown from '../dropdown'

const mockReplace = vi.fn()
const mockDownloadBlob = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockUpdateMutate = vi.fn()
const mockExportMutateAsync = vi.fn()
const mockDeleteMutate = vi.fn()
let mockWorkspacePermissionKeys: string[] = ['snippets.create_and_modify', 'snippets.management']
const mockConsoleState = vi.hoisted(() => ({
  current: {
    get workspacePermissionKeys() {
      return mockWorkspacePermissionKeys
    },
  },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (args: { data: Blob; fileName: string }) => mockDownloadBlob(args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
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

const mockSnippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Social Media Repurposer',
  description: 'Turn one blog post into multiple social media variations.',
  updatedAt: '2026-03-25 10:00',
  usage: '12',
  tags: [],
  status: undefined,
}

describe('SnippetInfoDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys = ['snippets.create_and_modify', 'snippets.management']
  })

  // Rendering coverage for the menu trigger itself.
  describe('Rendering', () => {
    it('should render the dropdown trigger button', () => {
      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      expect(screen.getByRole('button', { name: 'common.operation.more' })).toBeInTheDocument()
    })

    it('should render nothing without snippet create or management permission', () => {
      mockWorkspacePermissionKeys = []

      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should split edit from export and delete actions by snippet permission', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['snippets.create_and_modify']

      const { unmount } = render(<SnippetInfoDropdown snippet={mockSnippet} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(screen.getByText('snippet.menu.editInfo')).toBeInTheDocument()
      expect(screen.getByText('snippet.menu.exportSnippet')).toBeInTheDocument()
      expect(screen.queryByText('snippet.menu.deleteSnippet')).not.toBeInTheDocument()

      unmount()
      mockWorkspacePermissionKeys = ['snippets.management']
      render(<SnippetInfoDropdown snippet={mockSnippet} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(screen.queryByText('snippet.menu.editInfo')).not.toBeInTheDocument()
      expect(screen.queryByText('snippet.menu.exportSnippet')).not.toBeInTheDocument()
      expect(screen.getByText('snippet.menu.deleteSnippet')).toBeInTheDocument()
    })
  })

  // Edit flow should seed the dialog with current snippet info and submit updates.
  describe('Edit Snippet', () => {
    it('should open the edit dialog and submit snippet updates', async () => {
      const user = userEvent.setup()
      mockUpdateMutate.mockImplementation(
        (_variables: unknown, options?: { onSuccess?: () => void }) => {
          options?.onSuccess?.()
        },
      )

      render(<SnippetInfoDropdown snippet={mockSnippet} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByText('snippet.menu.editInfo'))

      expect(screen.getByRole('dialog', { name: 'snippet.editDialogTitle' })).toBeInTheDocument()
      expect(screen.getByText('snippet.editDialogTitle')).toBeInTheDocument()
      expect(screen.getByText('common.operation.save')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })).toHaveValue(
        mockSnippet.name,
      )
      if (!mockSnippet.description)
        throw new Error('mockSnippet.description is required for this test')
      expect(
        screen.getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' }),
      ).toHaveValue(mockSnippet.description)

      const name = screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
      const description = screen.getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' })
      await user.clear(name)
      await user.type(name, 'Updated snippet')
      await user.clear(description)
      await user.type(description, 'Updated description')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(mockUpdateMutate).toHaveBeenCalledWith(
        {
          params: { snippetId: mockSnippet.id },
          body: {
            name: 'Updated snippet',
            description: 'Updated description',
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
      expect(mockToastSuccess).toHaveBeenCalledWith('snippet.editDone')
    })
  })

  it('keeps the draft until the edit mutation succeeds and permits retry after failure', async () => {
    const user = userEvent.setup()
    let callbacks: { onSuccess: () => void; onError: (error: Error) => void } | undefined
    mockUpdateMutate.mockImplementation((_payload, options) => {
      callbacks = options
    })
    render(<SnippetInfoDropdown snippet={mockSnippet} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'snippet.menu.editInfo' }))
    const name = screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
    await user.clear(name)
    await user.type(name, 'Retry draft')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(name).toHaveValue('Retry draft')
    expect(screen.getByRole('dialog', { name: 'snippet.editDialogTitle' })).toBeInTheDocument()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    act(() => callbacks!.onError(new Error('Update failed')))
    expect(mockToastError).toHaveBeenCalledWith('Update failed')
    expect(name).toHaveValue('Retry draft')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockUpdateMutate).toHaveBeenCalledTimes(2)
    act(() => callbacks!.onSuccess())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockToastSuccess).toHaveBeenCalledWith('snippet.editDone')
  })

  // Export should call the export hook and download the returned YAML blob.
  describe('Export Snippet', () => {
    it('should export and download the snippet yaml', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['snippets.create_and_modify']
      mockExportMutateAsync.mockResolvedValue('yaml: content')

      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
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
      mockWorkspacePermissionKeys = ['snippets.create_and_modify']
      mockExportMutateAsync.mockRejectedValue(new Error('export failed'))

      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
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
      mockDeleteMutate.mockImplementation(
        (_variables: unknown, options?: { onSuccess?: () => void }) => {
          options?.onSuccess?.()
        },
      )

      render(<SnippetInfoDropdown snippet={mockSnippet} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByText('snippet.menu.deleteSnippet'))

      expect(screen.getByText('snippet.deleteConfirmTitle')).toBeInTheDocument()
      expect(screen.getByText('snippet.deleteConfirmContent')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      expect(mockDeleteMutate).toHaveBeenCalledWith(
        {
          params: { snippetId: mockSnippet.id },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
      expect(mockToastSuccess).toHaveBeenCalledWith('snippet.deleted')
      expect(mockReplace).toHaveBeenCalledWith('/snippets')
    })
  })
})
