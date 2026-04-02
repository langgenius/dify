import type { AppAssetTreeView } from '@/types/app-asset'
import { ROOT_ID } from '../../constants'
import {
  buildNodeMap,
  createDraftTreeNode,
  findNodeById,
  flattenMatchingNodes,
  getAllDescendantFileIds,
  getAncestorIds,
  getTargetFolderIdFromSelection,
  insertDraftTreeNode,
  isDescendantOf,
  isRootId,
  toApiParentId,
  toOpensObject,
} from '../tree-utils'

const tree: AppAssetTreeView[] = [
  {
    id: 'folder-a',
    node_type: 'folder',
    name: 'folder-a',
    path: '/folder-a',
    extension: '',
    size: 0,
    children: [
      {
        id: 'file-1',
        node_type: 'file',
        name: 'guide.md',
        path: '/folder-a/guide.md',
        extension: 'md',
        size: 10,
        children: [],
      },
      {
        id: 'folder-b',
        node_type: 'folder',
        name: 'folder-b',
        path: '/folder-a/folder-b',
        extension: '',
        size: 0,
        children: [
          {
            id: 'file-2',
            node_type: 'file',
            name: 'data.json',
            path: '/folder-a/folder-b/data.json',
            extension: 'json',
            size: 20,
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: 'empty-folder',
    node_type: 'folder',
    name: 'empty-folder',
    path: '/empty-folder',
    extension: '',
    size: 0,
    children: [],
  },
]

describe('tree-utils', () => {
  describe('root helpers', () => {
    it('should normalize root identifiers for API calls', () => {
      expect(isRootId(undefined)).toBe(true)
      expect(isRootId(ROOT_ID)).toBe(true)
      expect(isRootId('folder-a')).toBe(false)
      expect(toApiParentId(ROOT_ID)).toBeNull()
      expect(toApiParentId('folder-a')).toBe('folder-a')
    })

    it('should convert expanded ids into the opens object expected by the tree', () => {
      expect(toOpensObject(new Set(['folder-a', 'folder-b']))).toEqual({
        'folder-a': true,
        'folder-b': true,
      })
    })
  })

  describe('tree traversal', () => {
    it('should build node maps, find nodes, and collect ancestors', () => {
      const nodeMap = buildNodeMap(tree)

      expect(nodeMap.get('file-2')?.name).toBe('data.json')
      expect(findNodeById(tree, 'folder-b')?.name).toBe('folder-b')
      expect(findNodeById(tree, 'missing')).toBeNull()
      expect(getAncestorIds('file-2', tree)).toEqual(['folder-a', 'folder-b'])
      expect(getAncestorIds('missing', tree)).toEqual([])
    })

    it('should collect descendant file ids for folders and single files', () => {
      expect(getAllDescendantFileIds('folder-a', tree)).toEqual(['file-1', 'file-2'])
      expect(getAllDescendantFileIds('file-1', tree)).toEqual(['file-1'])
      expect(getAllDescendantFileIds('missing', tree)).toEqual([])
    })

    it('should resolve descendant relationships and target folders from selections', () => {
      expect(isDescendantOf('file-2', 'folder-a', tree)).toBe(true)
      expect(isDescendantOf('folder-a', 'folder-a', tree)).toBe(true)
      expect(isDescendantOf('file-1', 'empty-folder', tree)).toBe(false)
      expect(isDescendantOf(null, 'folder-a', tree)).toBe(false)

      expect(getTargetFolderIdFromSelection(null, tree)).toBe(ROOT_ID)
      expect(getTargetFolderIdFromSelection('folder-a', tree)).toBe('folder-a')
      expect(getTargetFolderIdFromSelection('file-2', tree)).toBe('folder-b')
      expect(getTargetFolderIdFromSelection('missing', tree)).toBe(ROOT_ID)
    })
  })

  describe('draft helpers', () => {
    it('should create and insert draft nodes at root or under a matching folder', () => {
      const draftFile = createDraftTreeNode({ id: 'draft-file', nodeType: 'file' })
      const draftFolder = createDraftTreeNode({ id: 'draft-folder', nodeType: 'folder' })

      expect(draftFile).toEqual({
        id: 'draft-file',
        node_type: 'file',
        name: '',
        path: '',
        extension: '',
        size: 0,
        children: [],
      })

      expect(insertDraftTreeNode(tree, null, draftFile)[0].id).toBe('draft-file')

      const inserted = insertDraftTreeNode(tree, 'folder-a', draftFolder)
      expect(inserted[0].children[0].id).toBe('draft-folder')

      const fallbackToRoot = insertDraftTreeNode(tree, 'missing', draftFile)
      expect(fallbackToRoot[0].id).toBe('draft-file')
    })
  })

  describe('search flattening', () => {
    it('should flatten matching nodes and include their parent paths', () => {
      expect(flattenMatchingNodes(tree, '')).toEqual([])
      expect(flattenMatchingNodes(tree, 'guide')).toEqual([
        {
          node: tree[0].children[0],
          parentPath: 'folder-a',
        },
      ])
      expect(flattenMatchingNodes(tree, 'folder')).toEqual([
        {
          node: tree[0],
          parentPath: '',
        },
        {
          node: tree[0].children[1],
          parentPath: 'folder-a',
        },
        {
          node: tree[1],
          parentPath: '',
        },
      ])
    })
  })
})
