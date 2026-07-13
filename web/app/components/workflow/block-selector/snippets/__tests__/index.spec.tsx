import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Snippets from '../index'

const mockUseInfiniteSnippetList = vi.fn()
const mockHandleInsertSnippet = vi.fn()

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

vi.mock('../snippet-tags-filter', () => ({
  default: ({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['tag-1'])}>
      {`tag-filter:${value.join(',')}`}
    </button>
  ),
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
      expect(
        screen.queryByRole('button', { name: 'workflow.tabs.createSnippet' }),
      ).not.toBeInTheDocument()
    })

    it('should render snippet rows from infinite list data', () => {
      mockUseInfiniteSnippetList.mockReturnValue({
        data: {
          pages: [
            {
              data: [
                {
                  id: 'snippet-1',
                  name: 'Customer Review',
                  description: 'Snippet description',
                  type: 'group',
                  is_published: true,
                  version: '1.0.0',
                  use_count: 3,
                  tags: [],
                  input_fields: [],
                  created_at: 1,
                  created_by: 'user-1',
                  updated_at: 2,
                  updated_by: 'user-1',
                },
              ],
            },
          ],
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
    it('should filter snippets by selected snippet tags', async () => {
      render(<Snippets searchText="" />)

      fireEvent.click(screen.getByRole('button', { name: 'tag-filter:' }))

      await waitFor(() => {
        expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith({
          page: 1,
          limit: 30,
          tag_ids: ['tag-1'],
          is_published: true,
        })
      })
    })

    it('should delegate embedded search changes', () => {
      const onSearchTextChange = vi.fn()

      render(<Snippets searchText="" onSearchTextChange={onSearchTextChange} />)

      fireEvent.change(screen.getByPlaceholderText('workflow.tabs.searchSnippets'), {
        target: { value: 'review' },
      })

      expect(onSearchTextChange).toHaveBeenCalledWith('review')
    })

    it('should delegate insert action when snippet item is clicked', () => {
      mockUseInfiniteSnippetList.mockReturnValue({
        data: {
          pages: [
            {
              data: [
                {
                  id: 'snippet-1',
                  name: 'Customer Review',
                  description: 'Snippet description',
                  type: 'group',
                  is_published: true,
                  version: '1.0.0',
                  use_count: 3,
                  tags: [],
                  input_fields: [],
                  created_at: 1,
                  created_by: 'user-1',
                  updated_at: 2,
                  updated_by: 'user-1',
                },
              ],
            },
          ],
        },
        isLoading: false,
        isFetching: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
      })

      render(<Snippets searchText="" />)

      fireEvent.click(screen.getByText('Customer Review'))

      expect(mockHandleInsertSnippet).toHaveBeenCalledWith('snippet-1', undefined)
    })
  })
})
