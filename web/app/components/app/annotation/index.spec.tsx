import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Annotation from './index'
import type { AnnotationItem } from './type'
import { JobStatus } from './type'
import { type App, AppModeEnum } from '@/types/app'
import {
  addAnnotation,
  delAnnotation,
  delAnnotations,
  fetchAnnotationConfig,
  fetchAnnotationList,
  queryAnnotationJobStatus,
} from '@/service/annotation'
import { useProviderContext } from '@/context/provider-context'
import Toast from '@/app/components/base/toast'

jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  default: { notify: jest.fn() },
}))

jest.mock('ahooks', () => ({
  useDebounce: (value: any) => value,
}))

jest.mock('@/service/annotation', () => ({
  addAnnotation: jest.fn(),
  delAnnotation: jest.fn(),
  delAnnotations: jest.fn(),
  fetchAnnotationConfig: jest.fn(),
  editAnnotation: jest.fn(),
  fetchAnnotationList: jest.fn(),
  queryAnnotationJobStatus: jest.fn(),
  updateAnnotationScore: jest.fn(),
  updateAnnotationStatus: jest.fn(),
}))

jest.mock('@/context/provider-context', () => ({
  useProviderContext: jest.fn(),
}))

jest.mock('./filter', () => ({ children }: { children: React.ReactNode }) => (
  <div data-testid="filter">{children}</div>
))

jest.mock('./empty-element', () => () => <div data-testid="empty-element" />)

jest.mock('./header-opts', () => (props: any) => (
  <div data-testid="header-opts">
    <button data-testid="trigger-add" onClick={() => props.onAdd({ question: 'new question', answer: 'new answer' })}>
      add
    </button>
  </div>
))

let latestListProps: any

jest.mock('./list', () => (props: any) => {
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
})

jest.mock('./view-annotation-modal', () => (props: any) => {
  if (!props.isShow)
    return null
  return (
    <div data-testid="view-modal">
      <div>{props.item.question}</div>
      <button data-testid="view-modal-remove" onClick={props.onRemove}>remove</button>
      <button data-testid="view-modal-close" onClick={props.onHide}>close</button>
    </div>
  )
})

jest.mock('@/app/components/base/pagination', () => () => <div data-testid="pagination" />)
jest.mock('@/app/components/base/loading', () => () => <div data-testid="loading" />)
jest.mock('@/app/components/base/features/new-feature-panel/annotation-reply/config-param-modal', () => (props: any) => props.isShow ? <div data-testid="config-modal" /> : null)
jest.mock('@/app/components/billing/annotation-full/modal', () => (props: any) => props.show ? <div data-testid="annotation-full-modal" /> : null)

const mockNotify = Toast.notify as jest.Mock
const addAnnotationMock = addAnnotation as jest.Mock
const delAnnotationMock = delAnnotation as jest.Mock
const delAnnotationsMock = delAnnotations as jest.Mock
const fetchAnnotationConfigMock = fetchAnnotationConfig as jest.Mock
const fetchAnnotationListMock = fetchAnnotationList as jest.Mock
const queryAnnotationJobStatusMock = queryAnnotationJobStatus as jest.Mock
const useProviderContextMock = useProviderContext as jest.Mock

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
    jest.clearAllMocks()
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
})
