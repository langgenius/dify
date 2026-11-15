import type { GenericTableRow } from '../generic-table'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import GenericTable from '../generic-table'

const columns = [{ key: 'name', title: 'Name', type: 'input' as const, width: 'flex-1' }]

function HeaderEditor({ initial = [] }: { initial?: GenericTableRow[] }) {
  const [data, setData] = useState(initial)
  return (
    <>
      <button type="button">Before parameters</button>
      <GenericTable
        title="Headers"
        columns={columns}
        data={data}
        emptyRowData={{ name: '' }}
        onChange={setData}
      />
    </>
  )
}

it('creates and edits a header, then reveals its delete action on keyboard focus and removes it', async () => {
  const screen = await render(<HeaderEditor />)
  const names = screen.getByRole('textbox', { name: 'Name', exact: true })
  await names.fill('Auth Token')
  await expect.element(names.first()).toHaveValue('Auth_Token')
  await expect.element(names.nth(1)).toHaveValue('')
  await names.first().fill('Authorization')
  await expect.element(names.first()).toHaveValue('Authorization')

  const before = screen.getByRole('button', { name: 'Before parameters' })
  await before.click()
  const remove = screen.getByRole('button', { name: 'Delete row' })
  await expect.element(remove).toBeInTheDocument()
  expect(remove.element().checkVisibility({ opacityProperty: true })).toBe(false)
  await userEvent.tab()
  await expect.element(names.first()).toHaveFocus()
  await userEvent.tab()
  await expect.element(remove).toHaveFocus()
  // Native visibility includes opacity on every ancestor without fixing the wrapper hierarchy.
  expect(remove.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(remove).not.toBeInTheDocument()
  await expect.element(names).toHaveValue('')
  expect(names.elements()).toHaveLength(1)
})

it('skips intermediate empty rows and ends input editing on Enter', async () => {
  const screen = await render(
    <HeaderEditor initial={[{ name: 'alpha' }, { name: '' }, { name: 'beta' }]} />,
  )
  const names = screen.getByRole('textbox', { name: 'Name', exact: true })
  expect(names.elements()).toHaveLength(3)
  await expect.element(names.nth(0)).toHaveValue('alpha')
  await expect.element(names.nth(1)).toHaveValue('beta')
  await expect.element(names.nth(2)).toHaveValue('')
  await names.first().click()
  await userEvent.keyboard('{Enter}')
  await expect.element(names.first()).not.toHaveFocus()
})

it('presents the readonly empty state without editable controls', async () => {
  const screen = await render(
    <GenericTable
      title="Headers"
      columns={columns}
      data={[]}
      emptyRowData={{ name: '' }}
      onChange={vi.fn()}
      readonly
      placeholder="No data"
    />,
  )
  await expect.element(screen.getByText('No data')).toBeVisible()
  await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument()
})
