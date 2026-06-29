import { useQuery } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SnippetTagsFilter from '../snippet-tags-filter'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    tags: {
      list: {
        queryOptions: vi.fn(input => ({ queryKey: ['tags', input] })),
      },
    },
  },
}))

const mockUseQuery = vi.mocked(useQuery)

describe('SnippetTagsFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: [
        { id: 'tag-1', name: 'Sales', type: 'snippet', binding_count: 1 },
        { id: 'tag-2', name: 'Support', type: 'snippet', binding_count: 2 },
      ],
    } as ReturnType<typeof useQuery>)
  })

  it('should show selected tag count and update selected tags', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<SnippetTagsFilter embedded value={['tag-1']} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Sales' }))

    expect(screen.getByText('1')).toBeInTheDocument()

    await user.click(screen.getByText('Support'))

    expect(onChange).toHaveBeenCalledWith(['tag-1', 'tag-2'], expect.anything())
  })

  it('should filter tags by search text and show an empty state', async () => {
    const user = userEvent.setup()

    render(<SnippetTagsFilter value={[]} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.tag.placeholder' }))
    await user.type(screen.getByPlaceholderText('pluginTags.searchTags'), 'sup')

    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.queryByText('Sales')).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText('pluginTags.searchTags'))
    await user.type(screen.getByPlaceholderText('pluginTags.searchTags'), 'missing')

    expect(screen.getByText('common.tag.noTag')).toBeInTheDocument()
  })
})
