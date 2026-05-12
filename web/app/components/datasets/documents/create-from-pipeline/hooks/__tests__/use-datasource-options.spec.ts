import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/workflow/types', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/app/components/workflow/types')
  const blockEnum = actual.BlockEnum as Record<string, string>
  return {
    ...actual,
    BlockEnum: {
      ...blockEnum,
      DataSource: 'data-source',
    },
  }
})

const { useDatasourceOptions } = await import('../use-datasource-options')

describe('useDatasourceOptions', () => {
  const createNode = (id: string, title: string, type: string): Node<DataSourceNodeType> => ({
    id,
    position: { x: 0, y: 0 },
    data: {
      type,
      title,
      provider_type: 'local_file',
    },
  } as unknown as Node<DataSourceNodeType>)

  it('should return empty array for no datasource nodes', () => {
    const nodes = [
      createNode('n1', 'LLM Node', 'llm'),
    ]
    const { result } = renderHook(() => useDatasourceOptions(nodes))
    expect(result.current).toEqual([])
  })

  it('should return options for datasource nodes', () => {
    const nodes = [
      createNode('n1', 'File Upload', 'data-source'),
      createNode('n2', 'Web Crawl', 'data-source'),
      createNode('n3', 'LLM Node', 'llm'),
    ]
    const { result } = renderHook(() => useDatasourceOptions(nodes))
    expect(result.current).toHaveLength(2)
    expect(result.current[0]).toEqual({
      label: 'File Upload',
      value: 'n1',
      data: expect.objectContaining({ title: 'File Upload' }),
    })
    expect(result.current[1]).toEqual({
      label: 'Web Crawl',
      value: 'n2',
      data: expect.objectContaining({ title: 'Web Crawl' }),
    })
  })
})
