import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { consoleClient } from '../console'
import { useImportPipelineDSL, useImportPipelineDSLConfirm } from '../use-pipeline'

vi.mock('../console', () => ({
  consoleClient: {
    rag: {
      pipelines: {
        imports: {
          post: vi.fn(),
          byImportId: { confirm: { post: vi.fn() } },
        },
      },
    },
  },
}))

const importPost = vi.mocked(consoleClient.rag.pipelines.imports.post)
const confirmPost = vi.mocked(consoleClient.rag.pipelines.imports.byImportId.confirm.post)

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('use-pipeline imports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const importResult = {
      id: 'import-id',
      status: DSLImportStatus.COMPLETED,
      pipeline_id: 'pipeline-id',
      dataset_id: 'dataset-id',
      current_dsl_version: '0.1.0',
      imported_dsl_version: '0.1.0',
    }
    importPost.mockResolvedValue(importResult as never)
    confirmPost.mockResolvedValue(importResult as never)
  })

  it('should import pipeline DSL silently so callers can own error toasts', async () => {
    const { result } = renderHook(() => useImportPipelineDSL(), { wrapper: createWrapper() })
    const request = {
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'rag_pipeline: {}',
    }

    await act(async () => {
      await result.current.mutateAsync(request)
    })

    expect(importPost).toHaveBeenCalledWith({ body: request }, { context: { silent: true } })
  })

  it('should confirm pipeline DSL import silently so callers can own error toasts', async () => {
    const { result } = renderHook(() => useImportPipelineDSLConfirm(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync('import-id')
    })

    expect(confirmPost).toHaveBeenCalledWith(
      { params: { import_id: 'import-id' } },
      { context: { silent: true } },
    )
  })
})
