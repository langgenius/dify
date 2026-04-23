import type { ToolWithProvider } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import useCurrentToolCollection from '../use-current-tool-collection'

const mockUseAllBuiltInTools = vi.hoisted(() => vi.fn())
const mockUseAllCustomTools = vi.hoisted(() => vi.fn())
const mockUseAllWorkflowTools = vi.hoisted(() => vi.fn())
const mockUseAllMCPTools = vi.hoisted(() => vi.fn())
const mockCanFindTool = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => mockUseAllBuiltInTools(),
  useAllCustomTools: () => mockUseAllCustomTools(),
  useAllWorkflowTools: () => mockUseAllWorkflowTools(),
  useAllMCPTools: () => mockUseAllMCPTools(),
}))

vi.mock('@/utils', () => ({
  canFindTool: (...args: unknown[]) => mockCanFindTool(...args),
}))

const createToolCollection = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  id: 'builtin-search',
  name: 'Google Search',
  type: CollectionType.builtIn,
  label: { en_US: 'Google Search' },
  description: { en_US: 'Search provider' },
  icon: '',
  icon_dark: '',
  background: '',
  tags: [],
  tools: [],
  allow_delete: true,
  is_team_authorization: false,
  meta: {} as ToolWithProvider['meta'],
  ...overrides,
}) as ToolWithProvider

describe('useCurrentToolCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanFindTool.mockImplementation((collectionId: string, providerId: string) => collectionId === providerId)
    mockUseAllBuiltInTools.mockReturnValue({ data: [] })
    mockUseAllCustomTools.mockReturnValue({ data: [] })
    mockUseAllWorkflowTools.mockReturnValue({ data: [] })
    mockUseAllMCPTools.mockReturnValue({ data: [] })
  })

  it('should return the built-in collection list and matched provider for built-in tools', () => {
    const builtInCollection = createToolCollection({ id: 'builtin-search' })
    mockUseAllBuiltInTools.mockReturnValue({ data: [builtInCollection] })

    const { result } = renderHook(() => useCurrentToolCollection(CollectionType.builtIn, 'builtin-search'))

    expect(result.current.currentTools).toEqual([builtInCollection])
    expect(result.current.currCollection).toBe(builtInCollection)
    expect(mockCanFindTool).toHaveBeenCalledWith('builtin-search', 'builtin-search')
  })

  it('should select the custom tool collection when the provider type is custom', () => {
    const customCollection = createToolCollection({
      id: 'custom-search',
      type: CollectionType.custom,
    })
    mockUseAllCustomTools.mockReturnValue({ data: [customCollection] })

    const { result } = renderHook(() => useCurrentToolCollection(CollectionType.custom, 'custom-search'))

    expect(result.current.currentTools).toEqual([customCollection])
    expect(result.current.currCollection).toBe(customCollection)
  })

  it('should return undefined when no collection matches the provider id', () => {
    mockUseAllBuiltInTools.mockReturnValue({
      data: [createToolCollection({ id: 'another-tool' })],
    })

    const { result } = renderHook(() => useCurrentToolCollection(CollectionType.builtIn, 'builtin-search'))

    expect(result.current.currentTools).toHaveLength(1)
    expect(result.current.currCollection).toBeUndefined()
  })
})
