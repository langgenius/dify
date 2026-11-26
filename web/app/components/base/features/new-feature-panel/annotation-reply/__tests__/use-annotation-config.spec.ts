import type { AnnotationReplyConfig } from '@/models/debug'
import { act } from '@testing-library/react'
import { useState } from 'react'
import { updateAnnotationStatus } from '@/service/annotation'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import useAnnotationConfig from '../use-annotation-config'

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

function renderConfig(
  initialConfig: AnnotationReplyConfig,
  options: Parameters<typeof renderHookWithConsoleQuery>[1] = {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { annotation_quota_limit: { size: 5, limit: 100 } },
  },
) {
  return renderHookWithConsoleQuery(() => {
    const [config, setConfig] = useState(initialConfig)
    return {
      ...useAnnotationConfig({
        appId: 'test-app',
        annotationConfig: config,
        setAnnotationConfig: setConfig,
      }),
      config,
    }
  }, options)
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
    queryAnnotationJobStatus.mockResolvedValue({ job_status: 'completed' })
  })

  it('edits enabled annotation parameters without depending on unused creation quota', async () => {
    const { result } = renderConfig(
      { ...defaultConfig, enabled: true },
      {
        systemFeatures: { deployment_edition: 'CLOUD' },
      },
    )

    act(() => result.current.setIsShowAnnotationConfigInit(true))
    expect(result.current.isShowAnnotationConfigInit).toBe(true)
    await act(async () => {
      await result.current.handleEnableAnnotation(defaultConfig.embedding_model!)
    })
    expect(updateAnnotationStatus).toHaveBeenCalledWith(
      'test-app',
      'enable',
      defaultConfig.embedding_model,
      undefined,
    )
    expect(result.current.config).toEqual({ ...defaultConfig, enabled: true })
  })

  it('should enable annotation and update config', async () => {
    const { result } = renderConfig(defaultConfig)

    await act(async () => {
      await result.current.handleEnableAnnotation(
        {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-3-small',
        },
        0.95,
      )
    })

    const updatedConfig = result.current.config
    expect(updatedConfig.enabled).toBe(true)
    expect(updatedConfig.embedding_model.embedding_model_name).toBe('text-embedding-3-small')
    expect(updatedConfig.score_threshold).toBe(0.95)
    await act(async () => result.current.handleDisableAnnotation(updatedConfig.embedding_model!))
    expect(result.current.config.enabled).toBe(false)
  })

  it('should disable annotation and update config', async () => {
    const enabledConfig = { ...defaultConfig, enabled: true }
    const { result } = renderConfig(enabledConfig)

    await act(async () => {
      await result.current.handleDisableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-ada-002',
      })
    })

    const updatedConfig = result.current.config
    expect(updatedConfig.enabled).toBe(false)
  })

  it('should not disable when already disabled', async () => {
    const { result } = renderConfig(defaultConfig)

    await act(async () => {
      await result.current.handleDisableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-ada-002',
      })
    })

    expect(result.current.config).toEqual(defaultConfig)
    expect(updateAnnotationStatus).not.toHaveBeenCalled()
  })

  it('should set score threshold', () => {
    const { result } = renderConfig(defaultConfig)

    act(() => {
      result.current.setScore(0.85)
    })

    const updatedConfig = result.current.config
    expect(updatedConfig.score_threshold).toBe(0.85)
  })

  it('should preserve zero score threshold when enabling annotation', async () => {
    const zeroScoreConfig = { ...defaultConfig, score_threshold: 0 }
    const { result } = renderConfig(zeroScoreConfig)

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
    const updatedConfig = result.current.config
    expect(updatedConfig.score_threshold).toBe(0)
  })

  it('should set score and embedding model together', () => {
    const { result } = renderConfig(defaultConfig)

    act(() => {
      result.current.setScore(0.95, {
        embedding_provider_name: 'cohere',
        embedding_model_name: 'embed-english',
      })
    })

    const updatedConfig = result.current.config
    expect(updatedConfig.score_threshold).toBe(0.95)
    expect(updatedConfig.embedding_model.embedding_provider_name).toBe('cohere')
  })

  it('should show annotation full modal instead of config init when annotation is full', () => {
    const { result } = renderConfig(defaultConfig, {
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: { size: 100, limit: 100 } },
    })

    act(() => {
      result.current.setIsShowAnnotationConfigInit(true)
    })

    expect(result.current.isShowAnnotationFullModal).toBe(true)
    expect(result.current.isShowAnnotationConfigInit).toBe(false)
  })

  it('should not enable annotation when annotation is full', async () => {
    const { result } = renderConfig(defaultConfig, {
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: { size: 100, limit: 100 } },
    })

    await act(async () => {
      await result.current.handleEnableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-3-small',
      })
    })

    expect(result.current.config).toEqual(defaultConfig)
    expect(updateAnnotationStatus).not.toHaveBeenCalled()
  })

  it('waits between polling attempts and only commits after completion', async () => {
    vi.useFakeTimers()
    queryAnnotationJobStatus
      .mockResolvedValueOnce({ job_status: 'processing' })
      .mockResolvedValueOnce({ job_status: 'completed' })
    const { result } = renderConfig(defaultConfig)
    let pending: Promise<void>
    await act(async () => {
      pending = result.current.handleEnableAnnotation(defaultConfig.embedding_model, 0.95)
    })
    expect(result.current.config).toEqual(defaultConfig)
    expect(queryAnnotationJobStatus).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'test-app', action: 'enable', job_id: 'test-job-id' },
    })
    await act(async () => vi.advanceTimersByTimeAsync(1999))
    expect(queryAnnotationJobStatus).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await pending
    })
    expect(result.current.config).toEqual({
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
    const { result } = renderConfig(defaultConfig)
    await act(async () => {
      await expect(
        result.current.handleEnableAnnotation(defaultConfig.embedding_model),
      ).rejects.toThrow('Embedding model unavailable')
    })
    expect(queryAnnotationJobStatus).toHaveBeenCalledTimes(1)
    expect(result.current.config).toEqual(defaultConfig)
  })

  afterEach(() => vi.useRealTimers())
})
