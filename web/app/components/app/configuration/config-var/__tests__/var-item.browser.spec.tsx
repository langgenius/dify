import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import VarItem from '../var-item'

// Real CSS and native Tab navigation catch actions hidden behind group-hover;
// happy-dom cannot establish whether those actions are actually visible and focusable.
it('keeps variable actions visible and keyboard reachable without hovering and skips readonly actions', async () => {
  const onEdit = vi.fn()
  const onRemove = vi.fn()
  const screen = await render(
    <div className="w-96 p-4">
      <button type="button" className="mb-8">
        Before variables
      </button>
      <VarItem
        name="region"
        label="Region"
        required={false}
        type="string"
        onEdit={onEdit}
        onRemove={onRemove}
      />
      <section aria-label="Readonly variable">
        <VarItem
          readonly
          name="system_region"
          label="System region"
          required={false}
          type="string"
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      </section>
      <button type="button">After variables</button>
    </div>,
  )

  // Leave the pointer on this separate control throughout keyboard navigation.
  await screen.getByRole('button', { name: 'Before variables' }).click()
  const edit = screen.getByRole('button', { name: 'common.operation.edit' })
  const remove = screen.getByRole('button', { name: 'common.operation.delete' })
  await expect.element(edit).toBeVisible()
  await expect.element(remove).toBeVisible()
  await userEvent.tab()
  await expect.element(edit).toHaveFocus()
  expect(edit.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  expect(onEdit).toHaveBeenCalledTimes(1)
  await userEvent.tab()
  await expect.element(remove).toHaveFocus()
  expect(remove.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard(' ')
  expect(onRemove).toHaveBeenCalledTimes(1)

  await expect
    .element(screen.getByRole('region', { name: 'Readonly variable' }).getByRole('button'))
    .not.toBeInTheDocument()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'After variables' })).toHaveFocus()
})
