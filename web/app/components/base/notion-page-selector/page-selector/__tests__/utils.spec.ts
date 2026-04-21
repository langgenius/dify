import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import {
  buildNotionPageTree,
  getNextSelectedPageIds,
  getRootPageIds,
  getVisiblePageRows,
} from '../utils'

const buildPage = (overrides: Partial<DataSourceNotionPage>): DataSourceNotionPage => ({
  page_id: 'page-id',
  page_name: 'Page name',
  parent_id: 'root',
  page_icon: null,
  type: 'page',
  is_bound: false,
  ...overrides,
})

const list: DataSourceNotionPage[] = [
  buildPage({ page_id: 'root-1', page_name: 'Root 1', parent_id: 'root' }),
  buildPage({ page_id: 'child-1', page_name: 'Child 1', parent_id: 'root-1' }),
  buildPage({ page_id: 'grandchild-1', page_name: 'Grandchild 1', parent_id: 'child-1' }),
  buildPage({ page_id: 'child-2', page_name: 'Child 2', parent_id: 'root-1' }),
  buildPage({ page_id: 'orphan-1', page_name: 'Orphan 1', parent_id: 'missing-parent' }),
]

const pagesMap: DataSourceNotionPageMap = {
  'root-1': { ...list[0]!, workspace_id: 'workspace-1' },
  'child-1': { ...list[1]!, workspace_id: 'workspace-1' },
  'grandchild-1': { ...list[2]!, workspace_id: 'workspace-1' },
  'child-2': { ...list[3]!, workspace_id: 'workspace-1' },
  'orphan-1': { ...list[4]!, workspace_id: 'workspace-1' },
}

describe('page-selector utils', () => {
  it('should build a tree with descendants, depth, and ancestors', () => {
    const treeMap = buildNotionPageTree(list, pagesMap)

    expect(treeMap['root-1']!.children).toEqual(new Set(['child-1', 'child-2']))
    expect(treeMap['root-1']!.descendants).toEqual(new Set(['child-1', 'grandchild-1', 'child-2']))
    expect(treeMap['grandchild-1']!.depth).toBe(2)
    expect(treeMap['grandchild-1']!.ancestors).toEqual(['Root 1', 'Child 1'])
  })

  it('should return root page ids for true roots and pages with missing parents', () => {
    expect(getRootPageIds(list, pagesMap)).toEqual(['root-1', 'orphan-1'])
  })

  it('should return expanded tree rows in depth-first order when not searching', () => {
    const treeMap = buildNotionPageTree(list, pagesMap)

    const rows = getVisiblePageRows({
      list,
      pagesMap,
      searchValue: '',
      treeMap,
      rootPageIds: ['root-1'],
      expandedIds: new Set(['root-1', 'child-1']),
    })

    expect(rows.map(row => row.page.page_id)).toEqual([
      'root-1',
      'child-1',
      'grandchild-1',
      'child-2',
    ])
  })

  it('should return filtered search rows with ancestry metadata when searching', () => {
    const treeMap = buildNotionPageTree(list, pagesMap)

    const rows = getVisiblePageRows({
      list,
      pagesMap,
      searchValue: 'Grandchild',
      treeMap,
      rootPageIds: ['root-1'],
      expandedIds: new Set<string>(),
    })

    expect(rows).toEqual([
      expect.objectContaining({
        page: expect.objectContaining({ page_id: 'grandchild-1' }),
        ancestors: ['Root 1', 'Child 1'],
        hasChild: false,
        parentExists: true,
      }),
    ])
  })

  it('should toggle selected ids correctly in single and multiple mode', () => {
    const treeMap = buildNotionPageTree(list, pagesMap)

    expect(getNextSelectedPageIds({
      checkedIds: new Set(['root-1']),
      pageId: 'child-1',
      searchValue: '',
      selectionMode: 'single',
      treeMap,
    })).toEqual(new Set(['child-1']))

    expect(getNextSelectedPageIds({
      checkedIds: new Set<string>(),
      pageId: 'root-1',
      searchValue: '',
      selectionMode: 'multiple',
      treeMap,
    })).toEqual(new Set(['root-1', 'child-1', 'grandchild-1', 'child-2']))

    expect(getNextSelectedPageIds({
      checkedIds: new Set(['child-1']),
      pageId: 'child-1',
      searchValue: 'Child',
      selectionMode: 'multiple',
      treeMap,
    })).toEqual(new Set<string>())
  })
})
