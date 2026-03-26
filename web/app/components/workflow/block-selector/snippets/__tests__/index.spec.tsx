import { fireEvent, render, screen } from '@testing-library/react'
import Snippets from '../index'

const mockUseInfiniteSnippetList = vi.fn()
const mockHandleInsertSnippet = vi.fn()
const mockHandleCreateSnippet = vi.fn()
const mockHandleOpenCreateSnippetDialog = vi.fn()
const mockHandleCloseCreateSnippetDialog = vi.fn()

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  return {
    ...actual,
    useInfiniteScroll: vi.fn(),
  }
})

vi.mock('@/service/use-snippets', () => ({
  useInfiniteSnippetList: (...args: unknown[]) => mockUseInfiniteSnippetList(...args),
}))

vi.mock('../use-insert-snippet', () => ({
  useInsertSnippet: () => ({
    handleInsertSnippet: mockHandleInsertSnippet,
  }),
}))

vi.mock('../use-create-snippet', () => ({
  useCreateSnippet: () => ({
    createSnippetMutation: { isPending: false },
    handleCloseCreateSnippetDialog: mockHandleCloseCreateSnippetDialog,
    handleCreateSnippet: mockHandleCreateSnippet,
    handleOpenCreateSnippetDialog: mockHandleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen: false,
    isCreatingSnippet: false,
  }),
}))

vi.mock('../../../create-snippet-dialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="create-snippet-dialog" /> : null,
}))

describe('Snippets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInfiniteSnippetList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    })
  })

  describe('Rendering', () => {
    it('should render loading skeleton when loading', () => {
      const { container } = render(<Snippets loading searchText="" />)

      expect(container.querySelectorAll('.bg-text-quaternary')).not.toHaveLength(0)
    })

    it('should render empty state when snippet list is empty', () => {
      render(<Snippets searchText="" />)

      expect(screen.getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
    })

    it('should render snippet rows from infinite list data', () => {
      mockUseInfiniteSnippetList.mockReturnValue({
        data: {
          pages: [{
            data: [{
              id: 'snippet-1',
              name: 'Customer Review',
              description: 'Snippet description',
              author: 'Evan',
              type: 'group',
              is_published: true,
              version: '1.0.0',
              use_count: 3,
              icon_info: {
                icon_type: 'emoji',
                icon: '🧾',
                icon_background: '#FFEAD5',
                icon_url: '',
              },
              input_fields: [],
              created_at: 1,
              updated_at: 2,
            }],
          }],
        },
        isLoading: false,
        isFetching: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
      })

      render(<Snippets searchText="customer" />)

      expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith({
        page: 1,
        limit: 30,
        keyword: 'customer',
        is_published: true,
      })
      expect(screen.getByText('Customer Review')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should delegate create action from empty state', () => {
      render(<Snippets searchText="" />)

      fireEvent.click(screen.getByRole('button', { name: 'workflow.tabs.createSnippet' }))

      expect(mockHandleOpenCreateSnippetDialog).toHaveBeenCalledTimes(1)
    })

    it('should delegate insert action when snippet item is clicked', () => {
      mockUseInfiniteSnippetList.mockReturnValue({
        data: {
          pages: [{
            data: [{
              id: 'snippet-1',
              name: 'Customer Review',
              description: 'Snippet description',
              author: 'Evan',
              type: 'group',
              is_published: true,
              version: '1.0.0',
              use_count: 3,
              icon_info: {
                icon_type: 'emoji',
                icon: '🧾',
                icon_background: '#FFEAD5',
                icon_url: '',
              },
              input_fields: [],
              created_at: 1,
              updated_at: 2,
            }],
          }],
        },
        isLoading: false,
        isFetching: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
      })

      render(<Snippets searchText="" />)

      fireEvent.click(screen.getByText('Customer Review'))

      expect(mockHandleInsertSnippet).toHaveBeenCalledWith('snippet-1')
    })
  })
})
