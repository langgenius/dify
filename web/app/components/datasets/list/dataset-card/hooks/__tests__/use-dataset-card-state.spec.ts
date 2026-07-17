import type { ReactNode } from 'react'
import type { DataSet } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDatasetCardState } from '../use-dataset-card-state'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/service/base', () => ({
  request: (...args: unknown[]) => mocks.request(...args),
  sseGeneratorPost: vi.fn(),
}))

vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({ mutateAsync: vi.fn() }),
}))

const dataset = {
  id: 'dataset-1',
  name: 'Test Dataset',
} as DataSet

function renderDatasetCardState() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        retry: false,
        staleTime: 5 * 60 * 1000,
      },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)

  return renderHook(useDatasetCardState, { initialProps: { dataset }, wrapper })
}

describe('useDatasetCardState', () => {
  it('shows the latest usage state each time delete confirmation is opened', async () => {
    mocks.request
      .mockResolvedValueOnce(Response.json({ is_using: false }))
      .mockResolvedValueOnce(Response.json({ is_using: true }))
    const { result } = renderDatasetCardState()

    await act(result.current.detectIsUsedByApp)
    expect(result.current.modalState.confirmMessage).toContain('deleteDatasetConfirmContent')

    act(result.current.closeConfirmDelete)
    await act(result.current.detectIsUsedByApp)

    expect(result.current.modalState.confirmMessage).toContain('datasetUsedByApp')
    expect(result.current.modalState.showConfirmDelete).toBe(true)
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(
      mocks.request.mock.calls.every(([url]) =>
        String(url).endsWith('/datasets/dataset-1/use-check'),
      ),
    ).toBe(true)
  })
})
