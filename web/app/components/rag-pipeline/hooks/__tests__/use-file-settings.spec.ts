import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { useFileSettings } from '../use-file-settings'

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

describe('useFileSettings', () => {
  it('should include file settings with image disabled', () => {
    const { result } = renderHook(() => useFileSettings())

    expect(result.current.image.enabled).toBe(false)
  })

  it('should set image detail to high resolution', () => {
    const { result } = renderHook(() => useFileSettings())

    expect(result.current.image.detail).toBe('high')
  })

  it('should set image number_limits to 3', () => {
    const { result } = renderHook(() => useFileSettings())

    expect(result.current.image.number_limits).toBe(3)
  })

  it('should include both transfer methods for image', () => {
    const { result } = renderHook(() => useFileSettings())

    expect(result.current.image.transfer_methods).toEqual(['local_file', 'remote_url'])
  })

  it('should pass through fileUploadConfig from store', () => {
    const { result } = renderHook(() => useFileSettings())

    expect(result.current.fileUploadConfig).toEqual({ max_size: 10 })
  })
})
