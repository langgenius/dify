import type { Annotation, AnnotationHitHistory } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import ViewAnnotationModal from '../index'

const mockFormatTime = vi.fn(() => 'formatted-time')

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

const { fetchHitHistoryListMock } = vi.hoisted(() => ({
  fetchHitHistoryListMock: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        annotations: { byAnnotationId: { hitHistories: { get: fetchHitHistoryListMock } } },
      },
    },
  },
}))

const createAnnotationItem = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: overrides.id ?? 'annotation-id',
  question: overrides.question ?? 'question',
  answer: overrides.answer ?? 'answer',
  created_at: overrides.created_at ?? 1700000000,
  hit_count: overrides.hit_count ?? 0,
})

const createHitHistoryItem = (
  overrides: Partial<AnnotationHitHistory> = {},
): AnnotationHitHistory => ({
  id: overrides.id ?? 'hit-id',
  question: overrides.question ?? 'query',
  match: overrides.match ?? 'match',
  response: overrides.response ?? 'response',
  source: overrides.source ?? 'source',
  score: overrides.score ?? 0.42,
  created_at: overrides.created_at ?? 1700000000,
})

const renderComponent = (props?: Partial<React.ComponentProps<typeof ViewAnnotationModal>>) => {
  const item = createAnnotationItem()
  const mergedProps: React.ComponentProps<typeof ViewAnnotationModal> = {
    appId: 'app-id',
    isShow: true,
    onHide: vi.fn(),
    item,
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    ...props,
  }
  return {
    ...render(<ViewAnnotationModal {...mergedProps} />),
    props: mergedProps,
  }
}

describe('ViewAnnotationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchHitHistoryListMock.mockResolvedValue({ data: [], total: 0 })
  })

  it.each([
    { type: 'query', index: 0, label: 'yourQuery', question: 'updated', answer: 'answer' },
    { type: 'answer', index: 1, label: 'yourAnswer', question: 'question', answer: 'updated' },
  ])(
    'saves the edited $type while retaining the other field',
    async ({ index, label, question, answer }) => {
      const user = userEvent.setup()
      const { props } = renderComponent()
      const panel = screen.getByRole('tabpanel', {
        name: 'appAnnotation.viewModal.annotatedResponse',
      })
      await user.click(within(panel).getAllByText('common.operation.edit')[index]!)
      await user.type(
        screen.getByRole('textbox', { name: `appAnnotation.editModal.${label}` }),
        'updated',
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(props.onSave).toHaveBeenCalledWith(question, answer)
    },
  )

  it('switches named panels with the keyboard while preserving the drawer name', async () => {
    const user = userEvent.setup()
    // Arrange
    const { props } = renderComponent()

    await waitFor(() => {
      expect(fetchHitHistoryListMock).toHaveBeenCalled()
    })

    // Act
    expect(
      screen.getByRole('dialog', { name: 'appAnnotation.viewModal.annotatedResponse' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'appAnnotation.viewModal.annotatedResponse' }))
    await user.keyboard('{ArrowRight}{Enter}')
    expect(screen.getByRole('tab', { name: 'appAnnotation.viewModal.hitHistory' })).toHaveFocus()
    expect(
      screen.getByRole('tabpanel', { name: 'appAnnotation.viewModal.hitHistory' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
    expect(
      screen.getByRole('dialog', { name: 'appAnnotation.viewModal.annotatedResponse' }),
    ).toBeInTheDocument()

    // Assert
    // Assert
    expect(await screen.findByText('appAnnotation.viewModal.noHitHistory'))!.toBeInTheDocument()
    expect(mockFormatTime).toHaveBeenCalledWith(props.item.created_at, 'appLog.dateTimeFormat')
  })

  it('should render hit history entries with their hit count when data exists', async () => {
    const user = userEvent.setup()
    const hits = [
      createHitHistoryItem({ question: 'user input' }),
      createHitHistoryItem({ id: 'hit-2', question: 'second' }),
    ]
    fetchHitHistoryListMock.mockResolvedValue({ data: hits, total: 15 })

    renderComponent()

    await user.click(await screen.findByText('appAnnotation.viewModal.hitHistory'))

    expect(await screen.findByText('user input'))!.toBeInTheDocument()
    expect(screen.getByText('15 appAnnotation.viewModal.hits'))!.toBeInTheDocument()
    expect(mockFormatTime).toHaveBeenCalledWith(hits[0]!.created_at, 'appLog.dateTimeFormat')
  })

  it('should confirm before removing the annotation and hide on success', async () => {
    const user = userEvent.setup()
    const { props } = renderComponent()

    await user.click(screen.getByText('appAnnotation.editModal.removeThisCache'))
    expect(
      await screen.findByText('appDebug.feature.annotation.removeConfirm'),
    )!.toBeInTheDocument()

    const confirmButton = await screen.findByRole('button', { name: 'common.operation.confirm' })
    expect(props.onRemove).not.toHaveBeenCalled()
    await user.click(confirmButton)

    await waitFor(() => {
      expect(props.onRemove).toHaveBeenCalledTimes(1)
      expect(props.onHide).toHaveBeenCalledTimes(1)
    })
  })

  it('should close the remove confirmation when cancelled', async () => {
    const user = userEvent.setup()
    const { props } = renderComponent()

    await user.click(screen.getByText('appAnnotation.editModal.removeThisCache'))
    expect(
      await screen.findByText('appDebug.feature.annotation.removeConfirm'),
    )!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(props.onHide).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(
        screen.queryByText('appDebug.feature.annotation.removeConfirm'),
      ).not.toBeInTheDocument()
    })
  })
})
