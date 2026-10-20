import type { AnnotationReplyConfig } from '@/models/debug'
import { act } from '@testing-library/react'
import { updateAnnotationStatus } from '@/service/annotation'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import useAnnotationConfig from '../use-annotation-config'

let mockIsAnnotationFull = false

const { queryAnnotationJobStatus } = vi.hoisted(() => ({
  queryAnnotationJobStatus: vi.fn().mockResolvedValue({ job_status: 'completed' }),
}))

vi.mock('@/service/annotation', () => ({
  updateAnnotationStatus: vi.fn().mockResolvedValue({ job_id: 'test-job-id' }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.annotationReply.byAction.status.byJobId.get': queryAnnotationJobStatus,
    }),
  }
})

function renderHook<Result>(callback: () => Result) {
  return renderHookWithConsoleQuery(callback, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { annotation_quota_limit: { size: mockIsAnnotationFull ? 100 : 5, limit: 100 } },
  })
}

describe('useAnnotationConfig', () => {
  const defaultConfig: AnnotationReplyConfig = {
    id: 'test-id',
    enabled: false,
    score_threshold: 0.9,
    embedding_model: {
      embedding_provider_name: 'openai',
      embedding_model_name: 'text-embedding-ada-002',
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryAnnotationJobStatus.mockResolvedValue({ job_status: 'completed' })
    mockIsAnnotationFull = false
  })

  it('edits enabled annotation parameters without depending on unused creation quota', async () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHookWithConsoleQuery(
      () =>
        useAnnotationConfig({
          appId: 'test-app',
          annotationConfig: { ...defaultConfig, enabled: true },
          setAnnotationConfig,
        }),
      { systemFeatures: { deployment_edition: 'CLOUD' } },
    )

    act(() => result.current.setIsShowAnnotationConfigInit(true))
    expect(result.current.isShowAnnotationConfigInit).toBe(true)
    await act(async () => {
      await result.current.handleEnableAnnotation(defaultConfig.embedding_model!)
    })
    expect(updateAnnotationStatus).toHaveBeenCalled()
    expect(setAnnotationConfig).toHaveBeenCalled()
  })

  it('should enable annotation and update config', async () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )

    await act(async () => {
      await result.current.handleEnableAnnotation(
        {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-3-small',
        },
        0.95,
      )
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0]![0]
    expect(updatedConfig.enabled).toBe(true)
    expect(updatedConfig.embedding_model.embedding_model_name).toBe('text-embedding-3-small')
    expect(updatedConfig.score_threshold).toBe(0.95)
  })

  it('should disable annotation and update config', async () => {
    const enabledConfig = { ...defaultConfig, enabled: true }
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: enabledConfig,
        setAnnotationConfig,
      }),
    )

    await act(async () => {
      await result.current.handleDisableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-ada-002',
      })
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0]![0]
    expect(updatedConfig.enabled).toBe(false)
  })

  it('should not disable when already disabled', async () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )

    await act(async () => {
      await result.current.handleDisableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-ada-002',
      })
    })

    expect(setAnnotationConfig).not.toHaveBeenCalled()
  })

  it('should set score threshold', () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )

    act(() => {
      result.current.setScore(0.85)
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0]![0]
    expect(updatedConfig.score_threshold).toBe(0.85)
  })

  it('should preserve zero score threshold when enabling annotation', async () => {
    const zeroScoreConfig = { ...defaultConfig, score_threshold: 0 }
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: zeroScoreConfig,
        setAnnotationConfig,
      }),
    )

    await act(async () => {
      await result.current.handleEnableAnnotation(
        {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-3-small',
        },
        0,
      )
    })

    expect(updateAnnotationStatus).toHaveBeenCalledWith(
      'test-app',
      'enable',
      {
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-3-small',
      },
      0,
    )
    const updatedConfig = setAnnotationConfig.mock.calls[0]![0]
    expect(updatedConfig.score_threshold).toBe(0)
  })

  it('should set score and embedding model together', () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )

    act(() => {
      result.current.setScore(0.95, {
        embedding_provider_name: 'cohere',
        embedding_model_name: 'embed-english',
      })
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0]![0]
    expect(updatedConfig.score_threshold).toBe(0.95)
    expect(updatedConfig.embedding_model.embedding_provider_name).toBe('cohere')
  })

  it('should show annotation full modal instead of config init when annotation is full', () => {
    mockIsAnnotationFull = true
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )

    act(() => {
      result.current.setIsShowAnnotationConfigInit(true)
    })

    expect(result.current.isShowAnnotationFullModal).toBe(true)
    expect(result.current.isShowAnnotationConfigInit).toBe(false)
  })

  it('should not enable annotation when annotation is full', async () => {
    mockIsAnnotationFull = true
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )

    await act(async () => {
      await result.current.handleEnableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-3-small',
      })
    })

    expect(setAnnotationConfig).not.toHaveBeenCalled()
  })

  it('waits between polling attempts and only commits after completion', async () => {
    vi.useFakeTimers()
    const setAnnotationConfig = vi.fn()
    queryAnnotationJobStatus
      .mockResolvedValueOnce({ job_status: 'processing' })
      .mockResolvedValueOnce({ job_status: 'completed' })
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )
    let pending: Promise<void>
    await act(async () => {
      pending = result.current.handleEnableAnnotation(defaultConfig.embedding_model, 0.95)
    })
    expect(setAnnotationConfig).not.toHaveBeenCalled()
    expect(queryAnnotationJobStatus).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'test-app', action: 'enable', job_id: 'test-job-id' },
    })
    await act(async () => vi.advanceTimersByTimeAsync(1999))
    expect(queryAnnotationJobStatus).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await pending
    })
    expect(setAnnotationConfig).toHaveBeenCalledExactlyOnceWith({
      ...defaultConfig,
      enabled: true,
      score_threshold: 0.95,
    })
  })

  it('stops polling and keeps the previous config when the job reports an error', async () => {
    queryAnnotationJobStatus.mockResolvedValueOnce({
      job_status: 'error',
      error_msg: 'Embedding model unavailable',
    })
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: defaultConfig,
        setAnnotationConfig,
      }),
    )
    await act(async () => {
      await expect(
        result.current.handleEnableAnnotation(defaultConfig.embedding_model),
      ).rejects.toThrow('Embedding model unavailable')
    })
    expect(queryAnnotationJobStatus).toHaveBeenCalledTimes(1)
    expect(setAnnotationConfig).not.toHaveBeenCalled()
  })

  afterEach(() => vi.useRealTimers())
})
