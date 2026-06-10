import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { post } from '../base'
import { useImportPipelineDSL, useImportPipelineDSLConfirm } from '../use-pipeline'

vi.mock('../base', () => ({
  post: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('use-pipeline imports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(post).mockResolvedValue({
      id: 'import-id',
      status: DSLImportStatus.COMPLETED,
      pipeline_id: 'pipeline-id',
      dataset_id: 'dataset-id',
      current_dsl_version: '0.1.0',
      imported_dsl_version: '0.1.0',
    })
  })

  it('should import pipeline DSL silently so callers can own error toasts', async () => {
    const { result } = renderHook(
      () => useImportPipelineDSL(),
      { wrapper: createWrapper() },
    )
    const request = {
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'rag_pipeline: {}',
    }

    await act(async () => {
      await result.current.mutateAsync(request)
    })

    expect(post).toHaveBeenCalledWith(
      '/rag/pipelines/imports',
      { body: request },
      { silent: true },
    )
  })

  it('should confirm pipeline DSL import silently so callers can own error toasts', async () => {
    const { result } = renderHook(
      () => useImportPipelineDSLConfirm(),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.mutateAsync('import-id')
    })

    expect(post).toHaveBeenCalledWith(
      '/rag/pipelines/imports/import-id/confirm',
      {},
      { silent: true },
    )
  })
})
