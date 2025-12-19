import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import List from './list'
import type { AnnotationItem } from './type'

const mockFormatTime = jest.fn(() => 'formatted-time')

jest.mock('@/hooks/use-timestamp', () => ({
  __esModule: true,
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

const createAnnotation = (overrides: Partial<AnnotationItem> = {}): AnnotationItem => ({
  id: overrides.id ?? 'annotation-id',
  question: overrides.question ?? 'question 1',
  answer: overrides.answer ?? 'answer 1',
  created_at: overrides.created_at ?? 1700000000,
  hit_count: overrides.hit_count ?? 2,
})

const getCheckboxes = (container: HTMLElement) => container.querySelectorAll('[data-testid^="checkbox"]')

describe('List', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should render annotation rows and call onView when clicking a row', () => {
    const item = createAnnotation()
    const onView = jest.fn()

    render(
      <List
        list={[item]}
        onView={onView}
        onRemove={jest.fn()}
        selectedIds={[]}
        onSelectedIdsChange={jest.fn()}
        onBatchDelete={jest.fn()}
        onCancel={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByText(item.question))

    expect(onView).toHaveBeenCalledWith(item)
    expect(mockFormatTime).toHaveBeenCalledWith(item.created_at, 'appLog.dateTimeFormat')
  })

  it('should toggle single and bulk selection states', () => {
    const list = [createAnnotation({ id: 'a', question: 'A' }), createAnnotation({ id: 'b', question: 'B' })]
    const onSelectedIdsChange = jest.fn()
    const { container, rerender } = render(
      <List
        list={list}
        onView={jest.fn()}
        onRemove={jest.fn()}
        selectedIds={[]}
        onSelectedIdsChange={onSelectedIdsChange}
        onBatchDelete={jest.fn()}
        onCancel={jest.fn()}
      />,
    )

    const checkboxes = getCheckboxes(container)
    fireEvent.click(checkboxes[1])
    expect(onSelectedIdsChange).toHaveBeenCalledWith(['a'])

    rerender(
      <List
        list={list}
        onView={jest.fn()}
        onRemove={jest.fn()}
        selectedIds={['a']}
        onSelectedIdsChange={onSelectedIdsChange}
        onBatchDelete={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    const updatedCheckboxes = getCheckboxes(container)
    fireEvent.click(updatedCheckboxes[1])
    expect(onSelectedIdsChange).toHaveBeenCalledWith([])

    fireEvent.click(updatedCheckboxes[0])
    expect(onSelectedIdsChange).toHaveBeenCalledWith(['a', 'b'])
  })

  it('should confirm before removing an annotation and expose batch actions', async () => {
    const item = createAnnotation({ id: 'to-delete', question: 'Delete me' })
    const onRemove = jest.fn()
    render(
      <List
        list={[item]}
        onView={jest.fn()}
        onRemove={onRemove}
        selectedIds={[item.id]}
        onSelectedIdsChange={jest.fn()}
        onBatchDelete={jest.fn()}
        onCancel={jest.fn()}
      />,
    )

    const row = screen.getByText(item.question).closest('tr') as HTMLTableRowElement
    const actionButtons = within(row).getAllByRole('button')
    fireEvent.click(actionButtons[1])

    expect(await screen.findByText('appDebug.feature.annotation.removeConfirm')).toBeInTheDocument()
    const confirmButton = await screen.findByRole('button', { name: 'common.operation.confirm' })
    fireEvent.click(confirmButton)
    expect(onRemove).toHaveBeenCalledWith(item.id)

    expect(screen.getByText('appAnnotation.batchAction.selected')).toBeInTheDocument()
  })
})
