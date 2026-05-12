import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useConfigsMap } from '../use-configs-map'

const mockPipelineId = 'pipeline-xyz'
const mockFileUploadConfig = { max_size: 10 }

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      pipelineId: mockPipelineId,
      fileUploadConfig: mockFileUploadConfig,
    }
    return selector(state)
  },
}))

vi.mock('@/types/app', () => ({
  Resolution: { high: 'high' },
  TransferMethod: { local_file: 'local_file', remote_url: 'remote_url' },
}))

vi.mock('@/types/common', () => ({
  FlowType: { ragPipeline: 'rag-pipeline' },
}))

describe('useConfigsMap', () => {
  it('should return flowId from pipelineId', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.flowId).toBe('pipeline-xyz')
  })

  it('should return ragPipeline as flowType', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.flowType).toBe('rag-pipeline')
  })

  it('should include file settings with image disabled', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.fileSettings.image.enabled).toBe(false)
  })

  it('should set image detail to high resolution', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.fileSettings.image.detail).toBe('high')
  })

  it('should set image number_limits to 3', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.fileSettings.image.number_limits).toBe(3)
  })

  it('should include both transfer methods for image', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.fileSettings.image.transfer_methods).toEqual(['local_file', 'remote_url'])
  })

  it('should pass through fileUploadConfig from store', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.fileSettings.fileUploadConfig).toEqual({ max_size: 10 })
  })
})
