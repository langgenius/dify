import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import SnippetTagsFilter from '../snippet-tags-filter'

const render = (ui: React.ReactElement<ComponentProps<typeof SnippetTagsFilter>>) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.tags.get.queryKey({ input: { query: { type: 'snippet' } } }),
    [
      { id: 'tag-1', name: 'Sales', type: 'snippet', binding_count: '' },
      { id: 'tag-2', name: 'Support', type: 'snippet', binding_count: '' },
    ],
  )
  return renderWithConsoleQuery(ui, { queryClient })
}

describe('SnippetTagsFilter', () => {
  it('should show selected tag count and update selected tags', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<SnippetTagsFilter embedded value={['tag-1']} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Sales' }))

    expect(screen.getByText('1')).toBeInTheDocument()

    await user.click(screen.getByText('Support'))

    expect(onChange.mock.lastCall?.[0]).toEqual(['tag-1', 'tag-2'])
  })

  it('should filter tags by search text and show an empty state', async () => {
    const user = userEvent.setup()

    render(<SnippetTagsFilter value={[]} onChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'common.tag.placeholder' })
    await user.click(trigger)
    const search = screen.getByRole('searchbox', { name: 'pluginTags.searchTags' })
    await user.type(search, 'sup')

    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.queryByText('Sales')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'missing')

    expect(screen.getByText('common.tag.noTag')).toBeInTheDocument()
  })

  it('resets the transient tag search after the popover closes', async () => {
    const user = userEvent.setup()

    render(<SnippetTagsFilter value={[]} onChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'common.tag.placeholder' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'common.tag.placeholder' })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'pluginTags.searchTags' }), 'sup')
    expect(screen.queryByText('Sales')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)

    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
  })
})
