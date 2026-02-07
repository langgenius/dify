import type { App, AppSSO } from '@/types/app'
import type { AppAssetTreeResponse, AppAssetTreeView } from '@/types/app-asset'
import { renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  useExistingSkillNames,
  useSkillAssetNodeMap,
  useSkillAssetTreeData,
} from './use-skill-asset-tree'

const { mockUseGetAppAssetTree } = vi.hoisted(() => ({
  mockUseGetAppAssetTree: vi.fn(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useGetAppAssetTree: (...args: unknown[]) => mockUseGetAppAssetTree(...args),
}))

const createTreeNode = (
  overrides: Partial<AppAssetTreeView> & Pick<AppAssetTreeView, 'id' | 'node_type' | 'name'>,
): AppAssetTreeView => ({
  id: overrides.id,
  node_type: overrides.node_type,
  name: overrides.name,
  path: overrides.path ?? `/${overrides.name}`,
  extension: overrides.extension ?? '',
  size: overrides.size ?? 0,
  children: overrides.children ?? [],
})

describe('useSkillAssetTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
    mockUseGetAppAssetTree.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    })
  })

  // Scenario: should pass app id from app store to the data query hook.
  describe('useSkillAssetTreeData', () => {
    it('should request tree data with current app id', () => {
      const expectedResult = { data: { children: [] }, isPending: false }
      mockUseGetAppAssetTree.mockReturnValue(expectedResult)

      const { result } = renderHook(() => useSkillAssetTreeData())

      expect(mockUseGetAppAssetTree).toHaveBeenCalledWith('app-1')
      expect(result.current).toBe(expectedResult)
    })

    it('should request tree data with empty app id when app detail is missing', () => {
      useAppStore.setState({ appDetail: undefined })

      renderHook(() => useSkillAssetTreeData())

      expect(mockUseGetAppAssetTree).toHaveBeenCalledWith('')
    })
  })

  // Scenario: should expose a select transform that builds node lookup maps.
  describe('useSkillAssetNodeMap', () => {
    it('should build a map including nested nodes', () => {
      renderHook(() => useSkillAssetNodeMap())

      const options = mockUseGetAppAssetTree.mock.calls[0][1] as {
        select: (data: AppAssetTreeResponse) => Map<string, AppAssetTreeView>
      }

      const map = options.select({
        children: [
          createTreeNode({
            id: 'folder-1',
            node_type: 'folder',
            name: 'skill-a',
            children: [
              createTreeNode({
                id: 'file-1',
                node_type: 'file',
                name: 'README.md',
                extension: 'md',
              }),
            ],
          }),
        ],
      })

      expect(map.get('folder-1')?.name).toBe('skill-a')
      expect(map.get('file-1')?.name).toBe('README.md')
      expect(map.size).toBe(2)
    })

    it('should return an empty map when tree response has no children', () => {
      renderHook(() => useSkillAssetNodeMap())

      const options = mockUseGetAppAssetTree.mock.calls[0][1] as {
        select: (data: AppAssetTreeResponse) => Map<string, AppAssetTreeView>
      }

      const map = options.select({} as AppAssetTreeResponse)

      expect(map.size).toBe(0)
    })
  })

  // Scenario: should expose root-level existing skill folder names.
  describe('useExistingSkillNames', () => {
    it('should collect only root folder names', () => {
      renderHook(() => useExistingSkillNames())

      const options = mockUseGetAppAssetTree.mock.calls[0][1] as {
        select: (data: AppAssetTreeResponse) => Set<string>
      }

      const names = options.select({
        children: [
          createTreeNode({
            id: 'folder-1',
            node_type: 'folder',
            name: 'skill-a',
            children: [
              createTreeNode({
                id: 'folder-2',
                node_type: 'folder',
                name: 'nested-folder',
              }),
            ],
          }),
          createTreeNode({
            id: 'file-1',
            node_type: 'file',
            name: 'README.md',
            extension: 'md',
          }),
          createTreeNode({
            id: 'folder-3',
            node_type: 'folder',
            name: 'skill-b',
          }),
        ],
      })

      expect(names.has('skill-a')).toBe(true)
      expect(names.has('skill-b')).toBe(true)
      expect(names.has('nested-folder')).toBe(false)
      expect(names.size).toBe(2)
    })

    it('should return an empty set when tree response has no children', () => {
      renderHook(() => useExistingSkillNames())

      const options = mockUseGetAppAssetTree.mock.calls[0][1] as {
        select: (data: AppAssetTreeResponse) => Set<string>
      }

      const names = options.select({} as AppAssetTreeResponse)

      expect(names.size).toBe(0)
    })
  })
})
