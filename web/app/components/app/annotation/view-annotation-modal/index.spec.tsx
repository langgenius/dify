import type { Mock } from 'vitest'
import type { AnnotationItem, HitHistoryItem } from '../type'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { fetchHitHistoryList } from '@/service/annotation'
import ViewAnnotationModal from './index'

const mockFormatTime = vi.fn(() => 'formatted-time')

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

vi.mock('@/service/annotation', () => ({
  fetchHitHistoryList: vi.fn(),
}))

vi.mock('../edit-annotation-modal/edit-item', () => {
  const EditItemType = {
    Query: 'query',
    Answer: 'answer',
  }
  return {
    default: ({ type, content, onSave }: { type: string, content: string, onSave: (value: string) => void }) => (
      <div>
        <div data-testid={`content-${type}`}>{content}</div>
        <button data-testid={`edit-${type}`} onClick={() => onSave(`${type}-updated`)}>
          edit-
          {type}
        </button>
      </div>
    ),
    EditItemType,
  }
})

const fetchHitHistoryListMock = fetchHitHistoryList as Mock

const createAnnotationItem = (overrides: Partial<AnnotationItem> = {}): AnnotationItem => ({
  id: overrides.id ?? 'annotation-id',
  question: overrides.question ?? 'question',
  answer: overrides.answer ?? 'answer',
  created_at: overrides.created_at ?? 1700000000,
  hit_count: overrides.hit_count ?? 0,
})

const createHitHistoryItem = (overrides: Partial<HitHistoryItem> = {}): HitHistoryItem => ({
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

  it('should render annotation tab and allow saving updated query', async () => {
    // Arrange
    const { props } = renderComponent()

    await waitFor(() => {
      expect(fetchHitHistoryListMock).toHaveBeenCalled()
    })

    // Act
    fireEvent.click(screen.getByTestId('edit-query'))

    // Assert
    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalledWith('query-updated', props.item.answer)
    })
  })

  it('should render annotation tab and allow saving updated answer', async () => {
    // Arrange
    const { props } = renderComponent()

    await waitFor(() => {
      expect(fetchHitHistoryListMock).toHaveBeenCalled()
    })

    // Act
    fireEvent.click(screen.getByTestId('edit-answer'))

    // Assert
    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalledWith(props.item.question, 'answer-updated')
    },
    )
  })

  it('should switch to hit history tab and show no data message', async () => {
    // Arrange
    const { props } = renderComponent()

    await waitFor(() => {
      expect(fetchHitHistoryListMock).toHaveBeenCalled()
    })

    // Act
    fireEvent.click(screen.getByText('appAnnotation.viewModal.hitHistory'))

    // Assert
    expect(await screen.findByText('appAnnotation.viewModal.noHitHistory')).toBeInTheDocument()
    expect(mockFormatTime).toHaveBeenCalledWith(props.item.created_at, 'appLog.dateTimeFormat')
  })

  it('should render hit history entries with pagination badge when data exists', async () => {
    const hits = [createHitHistoryItem({ question: 'user input' }), createHitHistoryItem({ id: 'hit-2', question: 'second' })]
    fetchHitHistoryListMock.mockResolvedValue({ data: hits, total: 15 })

    renderComponent()

    fireEvent.click(await screen.findByText('appAnnotation.viewModal.hitHistory'))

    expect(await screen.findByText('user input')).toBeInTheDocument()
    expect(screen.getByText('15 appAnnotation.viewModal.hits')).toBeInTheDocument()
    expect(mockFormatTime).toHaveBeenCalledWith(hits[0].created_at, 'appLog.dateTimeFormat')
  })

  it('should confirm before removing the annotation and hide on success', async () => {
    const { props } = renderComponent()

    fireEvent.click(screen.getByText('appAnnotation.editModal.removeThisCache'))
    expect(await screen.findByText('appDebug.feature.annotation.removeConfirm')).toBeInTheDocument()

    const confirmButton = await screen.findByRole('button', { name: 'common.operation.confirm' })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(props.onRemove).toHaveBeenCalledTimes(1)
      expect(props.onHide).toHaveBeenCalledTimes(1)
    })
  })
})
