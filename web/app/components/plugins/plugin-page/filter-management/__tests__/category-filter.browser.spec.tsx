import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import CategoriesFilter from '../category-filter'

function CategoriesExample({ initialValue = [] }: { initialValue?: string[] }) {
  const [categories, setCategories] = useState(initialValue)
  return (
    <>
      <CategoriesFilter value={categories} onChange={setCategories} />
      <output aria-label="Selected categories">{JSON.stringify(categories)}</output>
    </>
  )
}

beforeEach(async () => {
  await page.viewport(800, 600)
})

it('selects and removes real categories in the caller and the open picker', async () => {
  await render(<CategoriesExample />)
  await page.getByRole('button', { name: 'plugin.allCategories' }).click()
  const picker = page.getByRole('dialog')
  const tool = picker.getByRole('checkbox', { name: 'plugin.category.tools' })
  await tool.click()

  await expect.element(tool).toBeChecked()
  await expect.element(page.getByRole('button', { name: 'plugin.category.tools' })).toBeVisible()
  await expect
    .element(page.getByRole('status', { name: 'Selected categories' }))
    .toHaveTextContent('["tool"]')

  await tool.click()
  await expect.element(tool).not.toBeChecked()
  await expect.element(page.getByRole('button', { name: 'plugin.allCategories' })).toBeVisible()
  await expect
    .element(page.getByRole('status', { name: 'Selected categories' }))
    .toHaveTextContent('[]')
})

it('summarizes overflow selections and returns keyboard focus after clearing them', async () => {
  await render(<CategoriesExample initialValue={['tool', 'model', 'extension']} />)
  const trigger = page.getByRole('button', {
    name: 'plugin.category.tools,plugin.category.models +1',
  })
  await expect.element(trigger).toBeVisible()
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.tab()
  const clear = page.getByRole('button', { name: /^plugin.clearSearch/ })
  await expect.element(clear).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  await expect.element(clear).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Selected categories' }))
    .toHaveTextContent('[]')
  await expect.element(page.getByRole('button', { name: 'plugin.allCategories' })).toHaveFocus()
})

it('filters the real category catalog by the typed query', async () => {
  await render(<CategoriesExample />)
  await page.getByRole('button', { name: 'plugin.allCategories' }).click()
  const picker = page.getByRole('dialog')
  await expect
    .element(picker.getByRole('checkbox', { name: 'plugin.category.tools' }))
    .toBeVisible()
  await expect
    .element(picker.getByRole('checkbox', { name: 'plugin.category.extensions' }))
    .toBeVisible()
  await picker.getByRole('searchbox', { name: 'plugin.searchCategories' }).fill('mod')

  await expect
    .element(picker.getByRole('checkbox', { name: 'plugin.category.models' }))
    .toBeVisible()
  await expect
    .element(picker.getByRole('checkbox', { name: 'plugin.category.tools' }))
    .not.toBeInTheDocument()
  await expect
    .element(picker.getByRole('checkbox', { name: 'plugin.category.extensions' }))
    .not.toBeInTheDocument()
})
