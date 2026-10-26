import type { ComponentProps } from 'react'
import type { NotionPage } from '@/models/common'
import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryClientWrapper } from '@/test/console/query-client'
import NotionPagePreview from '../index'

const { request } = vi.hoisted(() => ({
  request: vi.fn<(url: string) => Promise<Response>>(),
}))

vi.mock('@/service/base', () => ({ request }))

const createPage = (overrides: Partial<NotionPage> = {}): NotionPage => ({
  page_id: 'page-a',
  page_name: 'Page A',
  page_icon: null,
  parent_id: 'parent-id',
  type: 'page',
  is_bound: false,
  workspace_id: 'workspace-id',
  ...overrides,
})

const pendingResponse = () => {
  let resolve!: (response: Response) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((resolveResponse, rejectResponse) => {
    resolve = resolveResponse
    reject = rejectResponse
  })
  return { promise, resolve, reject }
}

const renderPreview = (overrides: Partial<ComponentProps<typeof NotionPagePreview>> = {}) => {
  const props = {
    currentPage: createPage(),
    notionCredentialId: 'credential-a',
    hidePreview: vi.fn(),
    ...overrides,
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY } },
  })
  return {
    ...render(<NotionPagePreview {...props} />, {
      wrapper: createQueryClientWrapper(queryClient),
    }),
    props,
  }
}

describe('NotionPagePreview', () => {
  beforeEach(() => {
    request
      .mockReset()
      .mockImplementation(async () => Response.json({ content: 'Preview content' }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the selected page content when an earlier page response arrives last', async () => {
    const first = pendingResponse()
    const second = pendingResponse()
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { props, rerender } = renderPreview()

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))

    rerender(
      <NotionPagePreview
        {...props}
        currentPage={createPage({ page_id: 'page-b', page_name: 'Page B' })}
      />,
    )
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await act(async () => second.resolve(Response.json({ content: 'Page B content' })))

    expect(await screen.findByText('Page B content')).toBeInTheDocument()
    await act(async () => first.resolve(Response.json({ content: 'Page A content' })))

    expect(screen.getByText('Page B')).toBeInTheDocument()
    expect(screen.getByText('Page B content')).toBeInTheDocument()
    expect(screen.queryByText('Page A content')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it.each([
    {
      change: 'page ID',
      page: { page_id: 'page-b' },
      credential: 'credential-a',
      path: '/notion/pages/page-b/page/preview',
    },
    {
      change: 'page type',
      page: { type: 'database' },
      credential: 'credential-a',
      path: '/notion/pages/page-a/database/preview',
    },
    {
      change: 'credential',
      page: undefined,
      credential: 'credential-b',
      path: '/notion/pages/page-a/page/preview',
    },
  ])(
    'loads a separate preview when the $change changes without showing the previous content',
    async ({ page, credential, path }) => {
      const next = pendingResponse()
      request
        .mockImplementationOnce(async () => Response.json({ content: 'Previous content' }))
        .mockReturnValueOnce(next.promise)
      const { props, rerender } = renderPreview()
      await screen.findByText('Previous content')

      rerender(
        <NotionPagePreview
          {...props}
          currentPage={page ? createPage(page) : props.currentPage}
          notionCredentialId={credential}
        />,
      )

      expect(screen.queryByText('Previous content')).not.toBeInTheDocument()
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
      const url = new URL(request.mock.calls[1]![0])
      expect(url.pathname.endsWith(path)).toBe(true)
      expect(url.searchParams.get('credential_id')).toBe(credential)

      await act(async () => next.resolve(Response.json({ content: 'Updated content' })))

      expect(await screen.findByText('Updated content')).toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    },
  )

  it('updates page metadata without refetching an unchanged preview identity', async () => {
    const { props, rerender } = renderPreview()
    await screen.findByText('Preview content')

    await act(async () => {
      rerender(
        <NotionPagePreview {...props} currentPage={createPage({ page_name: 'Renamed page' })} />,
      )
    })

    expect(screen.getByText('Renamed page')).toBeInTheDocument()
    expect(screen.getByText('Preview content')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps retry focused while retrying and after another failure, then recovers', async () => {
    const user = userEvent.setup()
    const retry = pendingResponse()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    request
      .mockRejectedValueOnce(new Error('Preview unavailable'))
      .mockReturnValueOnce(retry.promise)
    renderPreview()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('Page A')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)

    const retryButton = screen.getByRole('button', { name: 'common.operation.retry' })
    await user.click(retryButton)

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(retryButton).toBeInTheDocument()
    expect(retryButton).toHaveFocus()
    expect(retryButton).toHaveAttribute('aria-disabled', 'true')

    await act(async () => retry.reject(new Error('Preview still unavailable')))

    await waitFor(() => expect(retryButton).not.toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(retryButton).toHaveFocus()
    expect(request).toHaveBeenCalledTimes(2)

    await user.click(retryButton)

    expect(await screen.findByText('Preview content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[1]![0]).toBe(request.mock.calls[0]![0])
    expect(request.mock.calls[2]![0]).toBe(request.mock.calls[0]![0])
  })

  it('waits for a credential without loading, then requests the selected preview', async () => {
    const { props, rerender } = renderPreview({ notionCredentialId: '' })

    expect(request).not.toHaveBeenCalled()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    rerender(<NotionPagePreview {...props} notionCredentialId="credential-b" />)

    expect(await screen.findByText('Preview content')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    expect(new URL(request.mock.calls[0]![0]).searchParams.get('credential_id')).toBe(
      'credential-b',
    )
  })

  it('does not request a preview without a selected page and clears content when selection is removed', async () => {
    const { props, rerender } = renderPreview({ currentPage: undefined })

    expect(request).not.toHaveBeenCalled()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    rerender(<NotionPagePreview {...props} currentPage={createPage()} />)
    await screen.findByText('Preview content')

    rerender(<NotionPagePreview {...props} currentPage={undefined} />)

    expect(screen.queryByText('Preview content')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('finishes loading successfully when the page has no content', async () => {
    request.mockImplementation(async () => Response.json({ content: '' }))
    renderPreview()

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())

    expect(screen.getByText('Page A')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })

  it('lets the user close the preview while it is loading', async () => {
    const user = userEvent.setup()
    request.mockReturnValue(pendingResponse().promise)
    const hidePreview = vi.fn()
    renderPreview({ hidePreview })

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(hidePreview).toHaveBeenCalledOnce()
  })
})
