import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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

vi.mock('../snippet-detail-card', () => ({
  default: ({ snippet }: { snippet: { name: string } }) => <div>{`preview:${snippet.name}`}</div>,
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
      mockUseInfiniteSnippetList.mockReturnValue({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        hasNextPage: undefined,
      })

      render(<Snippets searchText="" />)

      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    })

    it('should render empty state when snippet list is empty', () => {
      render(<Snippets searchText="" />)

      expect(screen.getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'workflow.tabs.createSnippet' }),
      ).not.toBeInTheDocument()
    })

    it('should keep cached snippet rows visible while refetching', () => {
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
        isFetching: true,
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
      const user = userEvent.setup()
      render(<Snippets searchText="" />)

      await user.click(screen.getByRole('button', { name: 'tag-filter:' }))

      await waitFor(() => {
        expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith({
          page: 1,
          limit: 30,
          tag_ids: ['tag-1'],
          is_published: true,
        })
      })
    })

    it('should delegate embedded search changes', async () => {
      const user = userEvent.setup()
      const onSearchTextChange = vi.fn()

      function Harness() {
        const [searchText, setSearchText] = useState('')

        return (
          <Snippets
            searchText={searchText}
            onSearchTextChange={(value) => {
              setSearchText(value)
              onSearchTextChange(value)
            }}
          />
        )
      }

      render(<Harness />)

      await user.type(screen.getByPlaceholderText('workflow.tabs.searchSnippets'), 'review')

      expect(onSearchTextChange).toHaveBeenLastCalledWith('review')

      await user.tab()
      const clearButton = screen.getByRole('button', {
        name: 'workflow.tabs.clearSnippetSearch',
      })
      expect(clearButton).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(onSearchTextChange).toHaveBeenLastCalledWith('')
    })

    it('should expose snippet rows as buttons and delegate insertion', async () => {
      const user = userEvent.setup()
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

      const snippet = screen.getByRole('button', { name: /Customer Review/ })
      await user.click(snippet)

      expect(mockHandleInsertSnippet).toHaveBeenCalledWith('snippet-1', undefined)
    })

    it('should show a preview from the keyboard when a snippet has no description', async () => {
      const user = userEvent.setup()
      mockUseInfiniteSnippetList.mockReturnValue({
        data: {
          pages: [
            {
              data: [
                {
                  id: 'snippet-1',
                  name: 'No Description',
                  description: '',
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

      await user.tab()
      await user.tab()
      await user.tab()

      expect(screen.getByRole('button', { name: 'No Description' })).toHaveFocus()
      expect(await screen.findByText('preview:No Description')).toBeInTheDocument()
    })
  })
})
