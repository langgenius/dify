import type { NotionPageTreeItem, NotionPageTreeMap } from '../index'
import type { DataSourceNotionPageMap } from '@/models/common'
import { describe, expect, it } from 'vitest'
import { recursivePushInParentDescendants } from '../utils'

const makePageEntry = (overrides: Partial<NotionPageTreeItem>): NotionPageTreeItem => ({
  page_icon: null,
  page_id: '',
  page_name: '',
  parent_id: '',
  type: 'page',
  is_bound: false,
  children: new Set(),
  descendants: new Set(),
  depth: 0,
  ancestors: [],
  ...overrides,
})

describe('recursivePushInParentDescendants', () => {
  it('should add child to parent descendants', () => {
    const pagesMap = {
      parent1: { page_id: 'parent1', parent_id: 'root', page_name: 'Parent' },
      child1: { page_id: 'child1', parent_id: 'parent1', page_name: 'Child' },
    } as unknown as DataSourceNotionPageMap

    const listTreeMap: NotionPageTreeMap = {
      child1: makePageEntry({ page_id: 'child1', parent_id: 'parent1', page_name: 'Child' }),
    }

    recursivePushInParentDescendants(pagesMap, listTreeMap, listTreeMap.child1, listTreeMap.child1)

    expect(listTreeMap.parent1).toBeDefined()
    expect(listTreeMap.parent1.children.has('child1')).toBe(true)
    expect(listTreeMap.parent1.descendants.has('child1')).toBe(true)
  })

  it('should recursively populate ancestors for deeply nested items', () => {
    const pagesMap = {
      grandparent: { page_id: 'grandparent', parent_id: 'root', page_name: 'Grandparent' },
      parent: { page_id: 'parent', parent_id: 'grandparent', page_name: 'Parent' },
      child: { page_id: 'child', parent_id: 'parent', page_name: 'Child' },
    } as unknown as DataSourceNotionPageMap

    const listTreeMap: NotionPageTreeMap = {
      parent: makePageEntry({ page_id: 'parent', parent_id: 'grandparent', page_name: 'Parent' }),
      child: makePageEntry({ page_id: 'child', parent_id: 'parent', page_name: 'Child' }),
    }

    recursivePushInParentDescendants(pagesMap, listTreeMap, listTreeMap.child, listTreeMap.child)

    expect(listTreeMap.child.depth).toBe(2)
    expect(listTreeMap.child.ancestors).toContain('Grandparent')
    expect(listTreeMap.child.ancestors).toContain('Parent')
  })

  it('should do nothing for root parent', () => {
    const pagesMap = {
      root_child: { page_id: 'root_child', parent_id: 'root', page_name: 'Root Child' },
    } as unknown as DataSourceNotionPageMap

    const listTreeMap: NotionPageTreeMap = {
      root_child: makePageEntry({ page_id: 'root_child', parent_id: 'root', page_name: 'Root Child' }),
    }

    recursivePushInParentDescendants(pagesMap, listTreeMap, listTreeMap.root_child, listTreeMap.root_child)

    // No new entries should be added since parent is root
    expect(Object.keys(listTreeMap)).toEqual(['root_child'])
  })

  it('should handle missing parent_id gracefully', () => {
    const pagesMap = {} as DataSourceNotionPageMap
    const current = makePageEntry({ page_id: 'orphan', parent_id: undefined as unknown as string })
    const listTreeMap: NotionPageTreeMap = { orphan: current }

    // Should not throw
    recursivePushInParentDescendants(pagesMap, listTreeMap, current, current)
    expect(listTreeMap.orphan.depth).toBe(0)
  })

  it('should add to existing parent entry when parent already in tree', () => {
    const pagesMap = {
      parent: { page_id: 'parent', parent_id: 'root', page_name: 'Parent' },
      child1: { page_id: 'child1', parent_id: 'parent', page_name: 'Child1' },
      child2: { page_id: 'child2', parent_id: 'parent', page_name: 'Child2' },
    } as unknown as DataSourceNotionPageMap

    const listTreeMap: NotionPageTreeMap = {
      parent: makePageEntry({ page_id: 'parent', parent_id: 'root', children: new Set(['child1']), descendants: new Set(['child1']), page_name: 'Parent' }),
      child2: makePageEntry({ page_id: 'child2', parent_id: 'parent', page_name: 'Child2' }),
    }

    recursivePushInParentDescendants(pagesMap, listTreeMap, listTreeMap.child2, listTreeMap.child2)

    expect(listTreeMap.parent.children.has('child2')).toBe(true)
    expect(listTreeMap.parent.descendants.has('child2')).toBe(true)
    expect(listTreeMap.parent.children.has('child1')).toBe(true)
  })
})
