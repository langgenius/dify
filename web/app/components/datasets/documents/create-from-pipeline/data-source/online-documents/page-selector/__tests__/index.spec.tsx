import type { ComponentProps } from 'react'
import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import PageSelector from '../index'

vi.mock('@tanstack/react-virtual')
const page = (id: string, name: string, parent = 'root'): DataSourceNotionPage => ({
  page_id: id,
  page_name: name,
  parent_id: parent,
  page_icon: null,
  is_bound: false,
  type: 'page',
})
const pages = [
  page('parent', 'Parent'),
  page('child', 'Child', 'parent'),
  page('grandchild', 'Grandchild', 'child'),
  page('other', 'Other'),
]
const mapPages = (list: DataSourceNotionPage[]): DataSourceNotionPageMap =>
  Object.fromEntries(list.map((item) => [item.page_id, { ...item, workspace_id: 'workspace' }]))
const defaults = {
  list: pages,
  pagesMap: mapPages(pages),
  disabledValue: new Set<string>(),
  searchValue: '',
}
function Harness(props: Partial<ComponentProps<typeof PageSelector>>) {
  const [selected, setSelected] = useState(props.checkedIds ?? new Set<string>())
  return (
    <PageSelector
      {...defaults}
      {...props}
      checkedIds={selected}
      onSelect={(ids) => {
        setSelected(ids)
        props.onSelect?.(ids)
      }}
    />
  )
}

it('expands nested pages and collapses descendants when their parent is collapsed', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  expect(screen.queryByRole('checkbox', { name: 'Child' })).not.toBeInTheDocument()
  await user.click(screen.getByTestId('notion-page-toggle-parent'))
  await user.click(screen.getByTestId('notion-page-toggle-child'))
  expect(screen.getByRole('checkbox', { name: 'Grandchild' })).toBeInTheDocument()
  await user.click(screen.getByTestId('notion-page-toggle-parent'))
  expect(screen.queryByRole('checkbox', { name: 'Child' })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Grandchild' })).not.toBeInTheDocument()
  await user.click(screen.getByTestId('notion-page-toggle-parent'))
  expect(screen.getByRole('checkbox', { name: 'Child' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Grandchild' })).not.toBeInTheDocument()
})

it('selects and deselects a complete subtree without changing an independent selection', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<Harness checkedIds={new Set(['other'])} onSelect={onSelect} />)
  await user.click(screen.getByRole('checkbox', { name: 'Parent' }))
  expect(onSelect).toHaveBeenLastCalledWith(new Set(['other', 'parent', 'child', 'grandchild']))
  await user.click(screen.getByRole('checkbox', { name: 'Parent' }))
  expect(onSelect).toHaveBeenLastCalledWith(new Set(['other']))
  expect(screen.getByRole('checkbox', { name: 'Other' })).toBeChecked()
})

it('selects only the matched page in search mode and shows its ancestors', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<Harness searchValue="Child" onSelect={onSelect} />)
  expect(screen.queryByRole('checkbox', { name: 'Parent' })).not.toBeInTheDocument()
  expect(screen.getByTitle('Parent / Child')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Child' }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(new Set(['child']))
})

it('selects one page without cascading in single-choice mode', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<Harness isMultipleChoice={false} onSelect={onSelect} />)
  await user.click(screen.getByRole('radio', { name: 'Parent' }))
  expect(onSelect).toHaveBeenLastCalledWith(new Set(['parent']))
  await user.click(screen.getByRole('radio', { name: 'Other' }))
  expect(onSelect).toHaveBeenLastCalledWith(new Set(['other']))
  expect(screen.getByRole('radio', { name: 'Parent' })).not.toBeChecked()
})

it.each([true, false])('blocks a disabled page in multiple-choice=%s mode', async (multiple) => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(
    <Harness isMultipleChoice={multiple} disabledValue={new Set(['other'])} onSelect={onSelect} />,
  )
  await user.click(screen.getByRole(multiple ? 'checkbox' : 'radio', { name: 'Other' }))
  expect(onSelect).not.toHaveBeenCalled()
  await user.click(screen.getByRole(multiple ? 'checkbox' : 'radio', { name: 'Parent' }))
  expect(onSelect).toHaveBeenCalledOnce()
})

it('previews the requested page without selecting it and hides preview when disabled', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  const onPreview = vi.fn()
  const { rerender } = render(<Harness onSelect={onSelect} onPreview={onPreview} />)
  await user.click(screen.getByTestId('notion-page-preview-other'))
  expect(onPreview).toHaveBeenCalledExactlyOnceWith('other')
  expect(onSelect).not.toHaveBeenCalled()
  rerender(<Harness canPreview={false} onSelect={onSelect} onPreview={onPreview} />)
  expect(screen.queryByTestId('notion-page-preview-other')).not.toBeInTheDocument()
})

it('updates visible results when documents or the search change', async () => {
  const { rerender } = render(<Harness list={[]} pagesMap={{}} />)
  expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()
  const list = [page('orphan', 'Orphan', 'missing-parent')]
  rerender(<Harness list={list} pagesMap={mapPages(list)} />)
  expect(screen.getByRole('checkbox', { name: 'Orphan' })).toBeInTheDocument()
  rerender(<Harness list={list} pagesMap={mapPages(list)} searchValue="missing" />)
  await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument())
  expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()
})
