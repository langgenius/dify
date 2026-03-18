import type { ToolNodeType } from '../../types'
import { renderHook } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '@/app/components/workflow/types'
import useGetDataForCheckMore from '../use-get-data-for-check-more'

const mockUseConfig = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

const createNodeData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Google Search',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: 'google_search',
  provider_type: CollectionType.builtIn,
  provider_name: 'Google Search',
  tool_name: 'google_search',
  tool_label: 'Google Search',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

describe('useGetDataForCheckMore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose the config hook validator as getData', () => {
    const getMoreDataForCheckValid = vi.fn(() => ({ provider: 'google' }))
    const payload = createNodeData()
    mockUseConfig.mockReturnValue({
      getMoreDataForCheckValid,
    })

    const { result } = renderHook(() => useGetDataForCheckMore({
      id: 'tool-node-1',
      payload,
    }))

    expect(mockUseConfig).toHaveBeenCalledWith('tool-node-1', payload)
    expect(result.current.getData).toBe(getMoreDataForCheckValid)
    expect(result.current.getData()).toEqual({ provider: 'google' })
  })
})
