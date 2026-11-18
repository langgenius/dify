import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TagFilter } from '../components/tag-filter'
import { renderWithTags } from './render-browser'

const tags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: '' },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: '' },
  { id: 'tag-3', name: 'Database', type: 'knowledge', binding_count: '' },
  { id: 'tag-4', name: 'API Design', type: 'app', binding_count: '' },
]
function renderFilter(
  { value = [], type = 'app' }: Partial<ComponentProps<typeof TagFilter>> = {},
  permissions = ['app.tag.manage'],
  data = tags,
) {
  function Owner() {
    const [selected, setSelected] = useState(value)
    const [managing, setManaging] = useState(false)
    return (
      <>
        <TagFilter
          type={type}
          value={selected}
          onChange={setSelected}
          onOpenTagManagement={() => setManaging(true)}
        />
        {managing && <h1>Manage tags</h1>}
      </>
    )
  }
  return renderWithTags(<Owner />, data, permissions)
}
const search = () => page.getByRole('combobox', { name: 'common.tag.selectorPlaceholder' })
const trigger = (name = 'common.tag.placeholder') => page.getByRole('combobox', { name })

it('filters by resource type and reflects pointer selection, deselection and clearing in its trigger', async () => {
  await renderFilter()
  await trigger().click()
  await expect.element(page.getByRole('option', { name: 'Frontend' })).toBeVisible()
  await expect.element(page.getByRole('option', { name: 'Database' })).not.toBeInTheDocument()
  await page.getByRole('option', { name: 'Frontend' }).click()
  await expect.element(trigger('Frontend')).toBeVisible()
  await page.getByRole('option', { name: 'Backend' }).click()
  await expect.element(trigger('Frontend, Backend')).toBeVisible()
  await expect.element(page.getByText('+1', { exact: true })).toBeVisible()
  await page.getByRole('option', { name: 'Frontend' }).click()
  await expect.element(trigger('Backend')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'common.operation.clear' }).click()
  await expect.element(trigger()).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'common.operation.clear' }))
    .not.toBeInTheDocument()
})

it('searches case-insensitively and selects a highlighted result with the native keyboard', async () => {
  await renderFilter()
  await trigger().click()
  await search().fill('back')
  await expect.element(page.getByRole('option', { name: 'Backend' })).toBeVisible()
  await expect.element(page.getByRole('option', { name: 'Frontend' })).not.toBeInTheDocument()
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(page.getByRole('option', { name: 'Backend' }))
    .toHaveAttribute('data-highlighted')
  await userEvent.keyboard('{Enter}')
  await expect.element(trigger('Backend')).toBeVisible()
})

it('keeps an empty search focused and recovers the result list when the query is cleared', async () => {
  await renderFilter()
  await trigger().click()
  await search().fill('missing')
  await expect.element(page.getByText(/common\.tag\.noTag/)).toBeVisible()
  await expect.element(search()).toHaveFocus()
  await search().fill('front')
  await expect.element(page.getByRole('option', { name: 'Frontend' })).toBeVisible()
  await expect.element(page.getByRole('option', { name: 'Backend' })).not.toBeInTheDocument()
})

it('offers only knowledge tags for a knowledge filter', async () => {
  await renderFilter({ type: 'knowledge' })
  await trigger().click()
  await expect.element(page.getByRole('option', { name: 'Database' })).toBeVisible()
  await expect.element(page.getByRole('option', { name: 'Frontend' })).not.toBeInTheDocument()
})

it('hands keyboard focus from search to management and closes the popup when management opens', async () => {
  await renderFilter()
  await trigger().click()
  await expect.element(search()).toHaveFocus()
  await userEvent.tab()
  const manage = page.getByRole('button', { name: 'common.tag.manageTags' })
  await expect.element(manage).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('heading', { name: 'Manage tags' })).toBeVisible()
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
})

it('keeps filtering available while omitting management without workspace permission', async () => {
  await renderFilter({}, [])
  await trigger().click()
  await expect
    .element(page.getByRole('button', { name: 'common.tag.manageTags' }))
    .not.toBeInTheDocument()
  await page.getByRole('option', { name: 'Frontend' }).click()
  await expect.element(trigger('Frontend')).toBeVisible()
})

it('shows the empty catalog without manufacturing selectable tags', async () => {
  await renderFilter({}, [], [])
  await trigger().click()
  await expect.element(page.getByText(/common\.tag\.noTag/)).toBeVisible()
  await expect.element(page.getByRole('option')).not.toBeInTheDocument()
})

it('preserves selections outside the fetched catalog when another tag is selected', async () => {
  await renderFilter({ value: ['missing-id'] })
  await trigger('common.dynamicSelect.selected:{"count":1}').click()
  await page.getByRole('option', { name: 'Frontend' }).click()
  await expect.element(trigger('common.dynamicSelect.selected:{"count":2}')).toBeVisible()
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
