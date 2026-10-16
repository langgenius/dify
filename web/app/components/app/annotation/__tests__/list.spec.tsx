import type { AnnotationItem } from '../type'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { List } from '../list'

const mockFormatTime = vi.fn(() => 'formatted-time')

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

const { mockedRequest } = vi.hoisted(() => ({
  mockedRequest:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: mockedRequest,
}))

const createAnnotation = (overrides: Partial<AnnotationItem> = {}): AnnotationItem => ({
  id: overrides.id ?? 'annotation-id',
  question: overrides.question ?? 'question 1',
  answer: overrides.answer ?? 'answer 1',
  created_at: overrides.created_at ?? 1700000000,
  hit_count: overrides.hit_count ?? 2,
})

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render annotation rows and call onView when clicking a row', () => {
    const item = createAnnotation()
    const onView = vi.fn()

    render(
      <List
        appId="app-1"
        list={[item]}
        onView={onView}
        onRemoved={vi.fn()}
        selectedIds={[]}
        onSelectedIdsChange={vi.fn()}
        onBatchDelete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(item.question!))

    expect(onView).toHaveBeenCalledWith(item)
    expect(mockFormatTime).toHaveBeenCalledWith(item.created_at, 'appLog.dateTimeFormat')
  })

  it('should toggle single and bulk selection states', () => {
    const list = [
      createAnnotation({ id: 'a', question: 'A' }),
      createAnnotation({ id: 'b', question: 'B' }),
    ]
    const onSelectedIdsChange = vi.fn()
    const { rerender } = render(
      <List
        appId="app-1"
        list={list}
        onView={vi.fn()}
        onRemoved={vi.fn()}
        selectedIds={[]}
        onSelectedIdsChange={onSelectedIdsChange}
        onBatchDelete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    expect(onSelectedIdsChange.mock.calls.at(-1)?.[0]).toEqual(['a'])

    rerender(
      <List
        appId="app-1"
        list={list}
        onView={vi.fn()}
        onRemoved={vi.fn()}
        selectedIds={['a']}
        onSelectedIdsChange={onSelectedIdsChange}
        onBatchDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    expect(onSelectedIdsChange.mock.calls.at(-1)?.[0]).toEqual([])

    fireEvent.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
    expect(onSelectedIdsChange.mock.calls.at(-1)?.[0]).toEqual(['a', 'b'])
  })

  it('should confirm before removing an annotation and expose batch actions', async () => {
    const item = createAnnotation({ id: 'to-delete', question: 'Delete me' })
    const onRemoved = vi.fn()
    mockedRequest.mockResolvedValue(Response.json({ result: 'success' }))
    render(
      <List
        appId="app-1"
        list={[item]}
        onView={vi.fn()}
        onRemoved={onRemoved}
        selectedIds={[item.id]}
        onSelectedIdsChange={vi.fn()}
        onBatchDelete={vi.fn()}
      />,
    )

    const row = screen.getByText(item.question!).closest('tr') as HTMLTableRowElement
    const actionButtons = within(row).getAllByRole('button')
    fireEvent.click(actionButtons[1]!)

    expect(
      await screen.findByText('appDebug.feature.annotation.removeConfirm'),
    )!.toBeInTheDocument()
    const confirmButton = await screen.findByRole('button', { name: 'common.operation.confirm' })
    fireEvent.click(confirmButton)
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalledTimes(1)
    })
    const [url, , options] = mockedRequest.mock.calls[0]!
    expect(url).toMatch(/\/apps\/app-1\/annotations\/to-delete$/)
    expect(options.request.method).toBe('DELETE')

    expect(screen.getByText('appAnnotation.batchAction.selected'))!.toBeInTheDocument()
  })

  it('should keep the remove confirmation open until the removal settles', async () => {
    const user = userEvent.setup()
    const item = createAnnotation({ id: 'to-delete', question: 'Delete me' })
    let settleRemove: (response: Response) => void = () => {}
    mockedRequest.mockReturnValue(
      new Promise<Response>((resolve) => {
        settleRemove = resolve
      }),
    )
    render(
      <List
        appId="app-1"
        list={[item]}
        onView={vi.fn()}
        onRemoved={vi.fn()}
        selectedIds={[]}
        onSelectedIdsChange={vi.fn()}
        onBatchDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.remove' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    settleRemove(Response.json({ result: 'success' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })
})
