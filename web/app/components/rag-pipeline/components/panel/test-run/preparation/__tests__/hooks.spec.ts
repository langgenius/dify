import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDatasourceOptions, useTestRunSteps } from '../hooks'

const mockNodes: Array<{ id: string; data: Partial<DataSourceNodeType> & { type: string } }> = []
vi.mock('reactflow', () => ({
  useNodes: () => mockNodes,
}))

it('moves between datasource selection and document processing', () => {
  const { result } = renderHook(() => useTestRunSteps())
  expect(result.current.currentStep).toBe(1)
  expect(result.current.steps.map((step) => step.value)).toEqual([
    'dataSource',
    'documentProcessing',
  ])
  act(() => result.current.handleNextStep())
  expect(result.current.currentStep).toBe(2)
  act(() => result.current.handleBackStep())
  expect(result.current.currentStep).toBe(1)
})

describe('useDatasourceOptions', () => {
  beforeEach(() => {
    mockNodes.length = 0
    vi.clearAllMocks()
  })

  it('should return empty options when no DataSource nodes', () => {
    mockNodes.push({ id: 'n1', data: { type: BlockEnum.LLM, title: 'LLM' } })

    const { result } = renderHook(() => useDatasourceOptions())

    expect(result.current).toEqual([])
  })

  it('should filter out non-DataSource nodes', () => {
    mockNodes.push(
      { id: 'ds-1', data: { type: BlockEnum.DataSource, title: 'Source' } },
      { id: 'llm-1', data: { type: BlockEnum.LLM, title: 'LLM' } },
      { id: 'inset-e-1', data: { type: BlockEnum.End, title: 'End' } },
    )

    const { result } = renderHook(() => useDatasourceOptions())

    expect(result.current).toEqual([
      { label: 'Source', value: 'ds-1', data: { type: BlockEnum.DataSource, title: 'Source' } },
    ])
  })
})
