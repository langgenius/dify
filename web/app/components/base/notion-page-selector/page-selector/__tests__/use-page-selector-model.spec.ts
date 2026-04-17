import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePageSelectorModel } from '../use-page-selector-model'

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
]

const pagesMap: DataSourceNotionPageMap = {
  'root-1': { ...list[0]!, workspace_id: 'workspace-1' },
  'child-1': { ...list[1]!, workspace_id: 'workspace-1' },
  'grandchild-1': { ...list[2]!, workspace_id: 'workspace-1' },
  'child-2': { ...list[3]!, workspace_id: 'workspace-1' },
}

const createProps = (
  overrides: Partial<Parameters<typeof usePageSelectorModel>[0]> = {},
): Parameters<typeof usePageSelectorModel>[0] => ({
  checkedIds: new Set<string>(),
  searchValue: '',
  pagesMap,
  list,
  onSelect: vi.fn(),
  previewPageId: undefined,
  onPreview: vi.fn(),
  selectionMode: 'multiple',
  ...overrides,
})

describe('usePageSelectorModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build visible rows from the expanded tree state', async () => {
    const { result } = renderHook(() => usePageSelectorModel(createProps()))

    expect(result.current.rows.map(row => row.page.page_id)).toEqual(['root-1'])

    act(() => {
      result.current.handleToggle('root-1')
    })

    await waitFor(() => {
      expect(result.current.rows.map(row => row.page.page_id)).toEqual([
        'root-1',
        'child-1',
        'child-2',
      ])
    })

    act(() => {
      result.current.handleToggle('child-1')
    })

    await waitFor(() => {
      expect(result.current.rows.map(row => row.page.page_id)).toEqual([
        'root-1',
        'child-1',
        'grandchild-1',
        'child-2',
      ])
    })
  })

  it('should select descendants when selecting a parent in multiple mode', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() => usePageSelectorModel(createProps({ onSelect })))

    act(() => {
      result.current.handleSelect('root-1')
    })

    expect(onSelect).toHaveBeenCalledWith(new Set([
      'root-1',
      'child-1',
      'grandchild-1',
      'child-2',
    ]))
  })

  it('should update local preview and respect the controlled previewPageId when provided', () => {
    const onPreview = vi.fn()
    const { result, rerender } = renderHook(
      props => usePageSelectorModel(props),
      { initialProps: createProps({ onPreview }) },
    )

    act(() => {
      result.current.handlePreview('child-1')
    })

    expect(onPreview).toHaveBeenCalledWith('child-1')
    expect(result.current.currentPreviewPageId).toBe('child-1')

    rerender(createProps({ onPreview, previewPageId: 'grandchild-1' }))

    expect(result.current.currentPreviewPageId).toBe('grandchild-1')
  })

  it('should expose filtered rows when the deferred search value changes', async () => {
    const { result, rerender } = renderHook(
      props => usePageSelectorModel(props),
      { initialProps: createProps() },
    )

    rerender(createProps({ searchValue: 'Grandchild' }))

    await waitFor(() => {
      expect(result.current.effectiveSearchValue).toBe('Grandchild')
      expect(result.current.rows.map(row => row.page.page_id)).toEqual(['grandchild-1'])
    })
  })
})
