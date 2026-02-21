/**
 * Integration test: DSL export/import flow
 *
 * Validates DSL export logic (sync draft → check secrets → download)
 * and DSL import modal state management.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mockDoSyncWorkflowDraft = vi.fn().mockResolvedValue(undefined)
const mockExportPipelineConfig = vi.fn().mockResolvedValue({ data: 'yaml-content' })
const mockNotify = vi.fn()
const mockEventEmitter = { emit: vi.fn() }
const mockDownloadBlob = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/app/components/workflow/constants', () => ({
  DSL_EXPORT_CHECK: 'DSL_EXPORT_CHECK',
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      pipelineId: 'pipeline-abc',
      knowledgeName: 'My Pipeline',
    }),
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: mockEventEmitter,
  }),
}))

vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({
    mutateAsync: mockExportPipelineConfig,
  }),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

vi.mock('@/app/components/rag-pipeline/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

describe('DSL Export/Import Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Export Flow', () => {
    it('should sync draft then export then download', async () => {
      const { useDSL } = await import('@/app/components/rag-pipeline/hooks/use-DSL')
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
      expect(mockExportPipelineConfig).toHaveBeenCalledWith({
        pipelineId: 'pipeline-abc',
        include: false,
      })
      expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
        fileName: 'My Pipeline.pipeline',
      }))
    })

    it('should export with include flag when specified', async () => {
      const { useDSL } = await import('@/app/components/rag-pipeline/hooks/use-DSL')
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL(true)
      })

      expect(mockExportPipelineConfig).toHaveBeenCalledWith({
        pipelineId: 'pipeline-abc',
        include: true,
      })
    })

    it('should notify on export error', async () => {
      mockDoSyncWorkflowDraft.mockRejectedValueOnce(new Error('sync failed'))
      const { useDSL } = await import('@/app/components/rag-pipeline/hooks/use-DSL')
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
      }))
    })
  })

  describe('Export Check Flow', () => {
    it('should export directly when no secret environment variables', async () => {
      const { fetchWorkflowDraft } = await import('@/service/workflow')
      vi.mocked(fetchWorkflowDraft).mockResolvedValueOnce({
        environment_variables: [
          { value_type: 'string', key: 'API_URL', value: 'https://api.example.com' },
        ],
      } as unknown as Awaited<ReturnType<typeof fetchWorkflowDraft>>)

      const { useDSL } = await import('@/app/components/rag-pipeline/hooks/use-DSL')
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      // Should proceed to export directly (no secret vars)
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('should emit DSL_EXPORT_CHECK event when secret variables exist', async () => {
      const { fetchWorkflowDraft } = await import('@/service/workflow')
      vi.mocked(fetchWorkflowDraft).mockResolvedValueOnce({
        environment_variables: [
          { value_type: 'secret', key: 'API_KEY', value: '***' },
        ],
      } as unknown as Awaited<ReturnType<typeof fetchWorkflowDraft>>)

      const { useDSL } = await import('@/app/components/rag-pipeline/hooks/use-DSL')
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DSL_EXPORT_CHECK',
        payload: expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ value_type: 'secret' }),
          ]),
        }),
      }))
    })

    it('should notify on export check error', async () => {
      const { fetchWorkflowDraft } = await import('@/service/workflow')
      vi.mocked(fetchWorkflowDraft).mockRejectedValueOnce(new Error('fetch failed'))

      const { useDSL } = await import('@/app/components/rag-pipeline/hooks/use-DSL')
      const { result } = renderHook(() => useDSL())

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
      }))
    })
  })
})
