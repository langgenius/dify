import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { createErrorToastCaches } from '@/app/query-error-toast'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import SnippetTagsFilter from '../snippet-tags-filter'

const mocks = vi.hoisted(() => ({
  getTags: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'tags.get': mocks.getTags }),
  }
})

const tagsLoadError = () =>
  createHttpError(
    { status: 500, statusText: '', headers: new Headers() },
    { message: 'Unavailable' },
  )

const renderWithFailingTags = (getTags: () => Promise<never>) => {
  mocks.getTags.mockImplementation(getTags)
  const queryClient = createConsoleQueryClient({ caches: createErrorToastCaches() })
  return renderWithConsoleQuery(<SnippetTagsFilter value={[]} onChange={vi.fn()} />, {
    queryClient,
  })
}

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

  describe('when the tags fail to load', () => {
    beforeEach(() => {
      vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('reports the failure while the popover is closed, since nothing shows it', async () => {
      renderWithFailingTags(() => Promise.reject(tagsLoadError()))

      await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Unavailable'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows the failure inline instead of reporting it while the popover is open', async () => {
      const user = userEvent.setup()
      const tagsResponse = createDeferred<never>()
      renderWithFailingTags(() => tagsResponse.promise)

      await user.click(screen.getByRole('button', { name: 'common.tag.placeholder' }))
      tagsResponse.reject(tagsLoadError())

      expect(await screen.findByRole('alert')).toHaveTextContent('workflow.common.loadFailed')
      expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeInTheDocument()
      // The cache reports after the render that follows the failure; let that window pass.
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
