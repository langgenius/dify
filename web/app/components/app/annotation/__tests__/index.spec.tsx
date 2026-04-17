/* eslint-disable ts/no-explicit-any */
import type { Mock } from 'vitest'
import type { AnnotationItem } from '../type'
import type { App } from '@/types/app'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { toast } from '@/app/components/base/ui/toast'
import { useProviderContext } from '@/context/provider-context'
import {
  addAnnotation,
  delAnnotation,
  delAnnotations,
  editAnnotation,
  fetchAnnotationConfig,
  fetchAnnotationList,
  queryAnnotationJobStatus,
  updateAnnotationScore,
  updateAnnotationStatus,
} from '@/service/annotation'
import { AppModeEnum } from '@/types/app'
import Annotation from '../index'
import { AnnotationEnableStatus, JobStatus } from '../type'

vi.mock('ahooks', () => ({
  useDebounce: (value: any) => value,
}))

vi.mock('@/service/annotation', () => ({
  addAnnotation: vi.fn(),
  delAnnotation: vi.fn(),
  delAnnotations: vi.fn(),
  fetchAnnotationConfig: vi.fn(),
  editAnnotation: vi.fn(),
  fetchAnnotationList: vi.fn(),
  queryAnnotationJobStatus: vi.fn(),
  updateAnnotationScore: vi.fn(),
  updateAnnotationStatus: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('../filter', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="filter">{children}</div>
  ),
}))

vi.mock('../empty-element', () => ({
  default: () => <div data-testid="empty-element" />,
}))

vi.mock('../header-opts', () => ({
  default: (props: any) => (
    <div data-testid="header-opts">
      <button data-testid="trigger-add" onClick={() => props.onAdd({ question: 'new question', answer: 'new answer' })}>
        add
      </button>
      <button data-testid="trigger-added" onClick={() => props.onAdded()}>
        added
      </button>
    </div>
  ),
}))

let latestListProps: any

vi.mock('../list', () => ({
  default: (props: any) => {
    latestListProps = props
    if (!props.list.length)
      return <div data-testid="list-empty" />
    return (
      <div data-testid="list">
        <button data-testid="list-view" onClick={() => props.onView(props.list[0])}>view</button>
        <button data-testid="list-remove" onClick={() => props.onRemove(props.list[0].id)}>remove</button>
        <button data-testid="list-batch-delete" onClick={() => props.onBatchDelete()}>batch-delete</button>
      </div>
    )
  },
}))

vi.mock('../view-annotation-modal', () => ({
  default: (props: any) => {
    if (!props.isShow)
      return null
    return (
      <div data-testid="view-modal">
        <div>{props.item.question}</div>
        <button data-testid="view-modal-remove" onClick={props.onRemove}>remove</button>
        <button data-testid="view-modal-save" onClick={() => props.onSave('Edited question', 'Edited answer')}>save</button>
        <button data-testid="view-modal-close" onClick={props.onHide}>close</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/features/new-feature-panel/annotation-reply/config-param-modal', () => ({
  default: (props: any) => props.isShow
    ? (
        <div data-testid="config-modal">
          <button
            data-testid="config-save"
            onClick={() => props.onSave({
              embedding_model_name: 'next-model',
              embedding_provider_name: 'next-provider',
            }, 0.7)}
          >
            save-config
          </button>
          <button data-testid="config-hide" onClick={props.onHide}>hide-config</button>
        </div>
      )
    : null,
}))
vi.mock('@/app/components/billing/annotation-full/modal', () => ({
  default: (props: any) => props.show
    ? (
        <div data-testid="annotation-full-modal">
          <button data-testid="hide-annotation-full-modal" onClick={props.onHide}>hide-full</button>
        </div>
      )
    : null,
}))

const mockNotify = vi.fn()
vi.spyOn(toast, 'success').mockImplementation((message, options) => {
  mockNotify({ type: 'success', message, ...options })
  return 'toast-success-id'
})
vi.spyOn(toast, 'error').mockImplementation((message, options) => {
  mockNotify({ type: 'error', message, ...options })
  return 'toast-error-id'
})
vi.spyOn(toast, 'warning').mockImplementation((message, options) => {
  mockNotify({ type: 'warning', message, ...options })
  return 'toast-warning-id'
})
vi.spyOn(toast, 'info').mockImplementation((message, options) => {
  mockNotify({ type: 'info', message, ...options })
  return 'toast-info-id'
})
const addAnnotationMock = addAnnotation as Mock
const delAnnotationMock = delAnnotation as Mock
const delAnnotationsMock = delAnnotations as Mock
const editAnnotationMock = editAnnotation as Mock
const fetchAnnotationConfigMock = fetchAnnotationConfig as Mock
const fetchAnnotationListMock = fetchAnnotationList as Mock
const queryAnnotationJobStatusMock = queryAnnotationJobStatus as Mock
const updateAnnotationScoreMock = updateAnnotationScore as Mock
const updateAnnotationStatusMock = updateAnnotationStatus as Mock
const useProviderContextMock = useProviderContext as Mock

const appDetail = {
  id: 'app-id',
  mode: AppModeEnum.CHAT,
} as App

const createAnnotation = (overrides: Partial<AnnotationItem> = {}): AnnotationItem => ({
  id: overrides.id ?? 'annotation-1',
  question: overrides.question ?? 'Question 1',
  answer: overrides.answer ?? 'Answer 1',
  created_at: overrides.created_at ?? 1700000000,
  hit_count: overrides.hit_count ?? 0,
})

const renderComponent = () => render(<Annotation appDetail={appDetail} />)

describe('Annotation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestListProps = undefined
    fetchAnnotationConfigMock.mockResolvedValue({
      id: 'config-id',
      enabled: false,
      embedding_model: {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
      },
      score_threshold: 0.5,
    })
    fetchAnnotationListMock.mockResolvedValue({ data: [], total: 0 })
    queryAnnotationJobStatusMock.mockResolvedValue({ job_status: JobStatus.completed })
    updateAnnotationStatusMock.mockResolvedValue({ job_id: 'job-1' })
    updateAnnotationScoreMock.mockResolvedValue(undefined)
    editAnnotationMock.mockResolvedValue(undefined)
    useProviderContextMock.mockReturnValue({
      plan: {
        usage: { annotatedResponse: 0 },
        total: { annotatedResponse: 10 },
      },
      enableBilling: false,
    })
  })

  it('should render empty element when no annotations are returned', async () => {
    renderComponent()

    expect(await screen.findByTestId('empty-element')).toBeInTheDocument()
    expect(fetchAnnotationListMock).toHaveBeenCalledWith(appDetail.id, expect.objectContaining({
      page: 1,
      keyword: '',
    }))
  })

  it('should handle annotation creation and refresh list data', async () => {
    const annotation = createAnnotation()
    fetchAnnotationListMock.mockResolvedValue({ data: [annotation], total: 1 })
    addAnnotationMock.mockResolvedValue(undefined)

    renderComponent()

    await screen.findByTestId('list')
    fireEvent.click(screen.getByTestId('trigger-add'))

    await waitFor(() => {
      expect(addAnnotationMock).toHaveBeenCalledWith(appDetail.id, { question: 'new question', answer: 'new answer' })
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        message: 'common.api.actionSuccess',
        type: 'success',
      }))
    })
    expect(fetchAnnotationListMock).toHaveBeenCalledTimes(2)
  })

  it('should support viewing items and running batch deletion success flow', async () => {
    const annotation = createAnnotation()
    fetchAnnotationListMock.mockResolvedValue({ data: [annotation], total: 1 })
    delAnnotationsMock.mockResolvedValue(undefined)
    delAnnotationMock.mockResolvedValue(undefined)

    renderComponent()
    await screen.findByTestId('list')

    await act(async () => {
      latestListProps.onSelectedIdsChange([annotation.id])
    })
    await waitFor(() => {
      expect(latestListProps.selectedIds).toEqual([annotation.id])
    })

    await act(async () => {
      await latestListProps.onBatchDelete()
    })
    await waitFor(() => {
      expect(delAnnotationsMock).toHaveBeenCalledWith(appDetail.id, [annotation.id])
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
      }))
      expect(latestListProps.selectedIds).toEqual([])
    })

    fireEvent.click(screen.getByTestId('list-view'))
    expect(screen.getByTestId('view-modal')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('view-modal-remove'))
    })
    await waitFor(() => {
      expect(delAnnotationMock).toHaveBeenCalledWith(appDetail.id, annotation.id)
    })
  })

  it('should show an error notification when batch deletion fails', async () => {
    const annotation = createAnnotation()
    fetchAnnotationListMock.mockResolvedValue({ data: [annotation], total: 1 })
    const error = new Error('failed')
    delAnnotationsMock.mockRejectedValue(error)

    renderComponent()
    await screen.findByTestId('list')

    await act(async () => {
      latestListProps.onSelectedIdsChange([annotation.id])
    })
    await waitFor(() => {
      expect(latestListProps.selectedIds).toEqual([annotation.id])
    })

    await act(async () => {
      await latestListProps.onBatchDelete()
    })

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: error.message,
      })
      expect(latestListProps.selectedIds).toEqual([annotation.id])
    })
  })

  it('should show the annotation-full modal when enabling annotations exceeds the plan quota', async () => {
    useProviderContextMock.mockReturnValue({
      plan: {
        usage: { annotatedResponse: 10 },
        total: { annotatedResponse: 10 },
      },
      enableBilling: true,
    })

    renderComponent()

    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)

    expect(screen.getByTestId('annotation-full-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('hide-annotation-full-modal'))
    expect(screen.queryByTestId('annotation-full-modal')).not.toBeInTheDocument()
  })

  it('should disable annotations and refetch config after the async job completes', async () => {
    fetchAnnotationConfigMock.mockResolvedValueOnce({
      id: 'config-id',
      enabled: true,
      embedding_model: {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
      },
      score_threshold: 0.5,
    }).mockResolvedValueOnce({
      id: 'config-id',
      enabled: false,
      embedding_model: {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
      },
      score_threshold: 0.5,
    })

    renderComponent()

    const toggle = await screen.findByRole('switch')
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(updateAnnotationStatusMock).toHaveBeenCalledWith(
        appDetail.id,
        AnnotationEnableStatus.disable,
        expect.objectContaining({
          embedding_model_name: 'model',
          embedding_provider_name: 'provider',
        }),
        0.5,
      )
      expect(queryAnnotationJobStatusMock).toHaveBeenCalledWith(appDetail.id, AnnotationEnableStatus.disable, 'job-1')
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        message: 'common.api.actionSuccess',
        type: 'success',
      }))
    })
  })

  it('should save annotation config changes and update the score when the modal confirms', async () => {
    fetchAnnotationConfigMock.mockResolvedValue({
      id: 'config-id',
      enabled: false,
      embedding_model: {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
      },
      score_threshold: 0.5,
    })

    renderComponent()

    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)

    expect(screen.getByTestId('config-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('config-save'))

    await waitFor(() => {
      expect(updateAnnotationStatusMock).toHaveBeenCalledWith(
        appDetail.id,
        AnnotationEnableStatus.enable,
        {
          embedding_model_name: 'next-model',
          embedding_provider_name: 'next-provider',
        },
        0.7,
      )
      expect(updateAnnotationScoreMock).toHaveBeenCalledWith(appDetail.id, 'config-id', 0.7)
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        message: 'common.api.actionSuccess',
        type: 'success',
      }))
    })
  })

  it('should refresh the list from the header shortcut and allow saving or closing the view modal', async () => {
    const annotation = createAnnotation()
    fetchAnnotationListMock.mockResolvedValue({ data: [annotation], total: 1 })

    renderComponent()

    await screen.findByTestId('list')
    fireEvent.click(screen.getByTestId('list-view'))

    fireEvent.click(screen.getByTestId('view-modal-save'))

    await waitFor(() => {
      expect(editAnnotationMock).toHaveBeenCalledWith(appDetail.id, annotation.id, {
        question: 'Edited question',
        answer: 'Edited answer',
      })
    })

    fireEvent.click(screen.getByTestId('view-modal-close'))
    expect(screen.queryByTestId('view-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('trigger-added'))

    expect(fetchAnnotationListMock).toHaveBeenCalled()
  })

  it('should clear selections on cancel and hide the config modal when requested', async () => {
    const annotation = createAnnotation()
    fetchAnnotationConfigMock.mockResolvedValue({
      id: 'config-id',
      enabled: true,
      embedding_model: {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
      },
      score_threshold: 0.5,
    })
    fetchAnnotationListMock.mockResolvedValue({ data: [annotation], total: 1 })

    renderComponent()

    await screen.findByTestId('list')

    await act(async () => {
      latestListProps.onSelectedIdsChange([annotation.id])
    })
    await act(async () => {
      latestListProps.onCancel()
    })

    expect(latestListProps.selectedIds).toEqual([])

    const configButton = document.querySelector('.action-btn') as HTMLButtonElement
    fireEvent.click(configButton)
    expect(await screen.findByTestId('config-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('config-hide'))
    expect(screen.queryByTestId('config-modal')).not.toBeInTheDocument()
  })
})
