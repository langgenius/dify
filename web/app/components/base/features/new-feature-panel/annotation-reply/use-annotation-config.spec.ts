import type { AnnotationReplyConfig } from '@/models/debug'
import { act, renderHook } from '@testing-library/react'
import useAnnotationConfig from './use-annotation-config'

let mockIsAnnotationFull = false
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      usage: { annotatedResponse: mockIsAnnotationFull ? 100 : 5 },
      total: { annotatedResponse: 100 },
    },
    enableBilling: true,
  }),
}))

vi.mock('@/service/annotation', () => ({
  updateAnnotationStatus: vi.fn().mockResolvedValue({ job_id: 'test-job-id' }),
  queryAnnotationJobStatus: vi.fn().mockResolvedValue({ job_status: 'completed' }),
}))

vi.mock('@/utils', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

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
    mockIsAnnotationFull = false
  })

  it('should initialize with annotation config init hidden', () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    expect(result.current.isShowAnnotationConfigInit).toBe(false)
    expect(result.current.isShowAnnotationFullModal).toBe(false)
  })

  it('should show annotation config init modal', () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    act(() => {
      result.current.setIsShowAnnotationConfigInit(true)
    })

    expect(result.current.isShowAnnotationConfigInit).toBe(true)
  })

  it('should hide annotation config init modal', () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    act(() => {
      result.current.setIsShowAnnotationConfigInit(true)
    })
    act(() => {
      result.current.setIsShowAnnotationConfigInit(false)
    })

    expect(result.current.isShowAnnotationConfigInit).toBe(false)
  })

  it('should enable annotation and update config', async () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    await act(async () => {
      await result.current.handleEnableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-3-small',
      }, 0.95)
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0][0]
    expect(updatedConfig.enabled).toBe(true)
    expect(updatedConfig.embedding_model.embedding_model_name).toBe('text-embedding-3-small')
  })

  it('should disable annotation and update config', async () => {
    const enabledConfig = { ...defaultConfig, enabled: true }
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: enabledConfig,
      setAnnotationConfig,
    }))

    await act(async () => {
      await result.current.handleDisableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-ada-002',
      })
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0][0]
    expect(updatedConfig.enabled).toBe(false)
  })

  it('should not disable when already disabled', async () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

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
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    act(() => {
      result.current.setScore(0.85)
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0][0]
    expect(updatedConfig.score_threshold).toBe(0.85)
  })

  it('should set score and embedding model together', () => {
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    act(() => {
      result.current.setScore(0.95, {
        embedding_provider_name: 'cohere',
        embedding_model_name: 'embed-english',
      })
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0][0]
    expect(updatedConfig.score_threshold).toBe(0.95)
    expect(updatedConfig.embedding_model.embedding_provider_name).toBe('cohere')
  })

  it('should show annotation full modal instead of config init when annotation is full', () => {
    mockIsAnnotationFull = true
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    act(() => {
      result.current.setIsShowAnnotationConfigInit(true)
    })

    expect(result.current.isShowAnnotationFullModal).toBe(true)
    expect(result.current.isShowAnnotationConfigInit).toBe(false)
  })

  it('should not enable annotation when annotation is full', async () => {
    mockIsAnnotationFull = true
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: defaultConfig,
      setAnnotationConfig,
    }))

    await act(async () => {
      await result.current.handleEnableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-3-small',
      })
    })

    expect(setAnnotationConfig).not.toHaveBeenCalled()
  })

  it('should set default score_threshold when enabling without one', async () => {
    const configWithoutThreshold = { ...defaultConfig, score_threshold: undefined as unknown as number }
    const setAnnotationConfig = vi.fn()
    const { result } = renderHook(() => useAnnotationConfig({
      appId: 'test-app',
      annotationConfig: configWithoutThreshold,
      setAnnotationConfig,
    }))

    await act(async () => {
      await result.current.handleEnableAnnotation({
        embedding_provider_name: 'openai',
        embedding_model_name: 'text-embedding-3-small',
      }, 0.95)
    })

    expect(setAnnotationConfig).toHaveBeenCalled()
    const updatedConfig = setAnnotationConfig.mock.calls[0][0]
    expect(updatedConfig.enabled).toBe(true)
    expect(updatedConfig.score_threshold).toBeDefined()
  })
})
