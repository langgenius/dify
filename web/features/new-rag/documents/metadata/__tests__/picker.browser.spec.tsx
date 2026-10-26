import type { DocumentMetadataField } from '../editor-model'
import { expect, it, vi } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DocumentMetadataPicker } from '../picker'

const fields: DocumentMetadataField[] = [
  {
    id: 'author',
    name: 'Author',
    type: 'string',
    count: 0,
    rowVersion: 1,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'year',
    name: 'Year',
    type: 'number',
    count: 0,
    rowVersion: 1,
    createdAt: '',
    updatedAt: '',
  },
]
const props = {
  fields,
  creating: false,
  error: false,
  loading: false,
  onCreate: vi.fn(),
  onManage: vi.fn(),
  onRetry: vi.fn(),
}

it('exposes the visible list immediately and selects a field without submitting the enclosing form', async () => {
  const onSelect = vi.fn()
  const onSubmit = vi.fn((event) => event.preventDefault())
  const screen = await render(
    <form onSubmit={onSubmit}>
      <DocumentMetadataPicker {...props} onSelect={onSelect} />
      <button type="submit">Save</button>
    </form>,
  )
  await screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }).click()
  const input = page.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' })
  await expect.element(input).toHaveFocus()
  await expect.element(input).toHaveAttribute('aria-expanded', 'true')
  await expect.element(page.getByRole('listbox')).toBeVisible()
  await input.fill('year')
  await expect.element(page.getByRole('option', { name: /Year/ })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(input).toHaveAttribute('aria-activedescendant')
  await userEvent.keyboard('{Enter}')
  await expect.element(input).not.toBeInTheDocument()
  expect(onSelect).toHaveBeenCalledWith(fields[1])
  expect(onSubmit).not.toHaveBeenCalled()
})

it('resets the search when returning from create and after one Escape closes the picker', async () => {
  const screen = await render(<DocumentMetadataPicker {...props} onSelect={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: 'dataset.metadata.addMetadata' })
  await trigger.click()
  const search = page.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' })
  await search.fill('year')
  await page.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }).click()
  await expect.element(page.getByRole('textbox')).toHaveFocus()
  await page.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(search).toHaveFocus()
  await expect.element(search).toHaveValue('')
  await search.fill('author')
  await userEvent.keyboard('{Escape}')
  await expect.element(search).not.toBeInTheDocument()
  await trigger.click()
  await expect.element(search).toHaveValue('')
  await expect.element(page.getByRole('option', { name: /Year/ })).toBeVisible()
})

it('does not submit the enclosing form when Enter has no matching field', async () => {
  const onSubmit = vi.fn((event) => event.preventDefault())
  const screen = await render(
    <form onSubmit={onSubmit}>
      <DocumentMetadataPicker {...props} onSelect={vi.fn()} />
      <button type="submit">Save</button>
    </form>,
  )
  await screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }).click()
  await page.getByRole('combobox').fill('missing')
  await expect.element(page.getByText('common.noData')).toBeVisible()
  await userEvent.keyboard('{Enter}')
  expect(onSubmit).not.toHaveBeenCalled()
  await expect.element(page.getByRole('combobox')).toBeVisible()
})
