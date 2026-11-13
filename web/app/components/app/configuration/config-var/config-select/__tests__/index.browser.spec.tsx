import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ConfigSelect from '../index'

function Options({ initial = ['First', 'Second'] }: { initial?: string[] }) {
  const [options, setOptions] = useState(initial)
  return <ConfigSelect options={options} onChange={setOptions} />
}

it('associates option errors with editable fields and removes the descriptions when corrected', async () => {
  const screen = await render(
    <>
      <ConfigSelect
        options={['First', 'Second']}
        onChange={vi.fn()}
        errorMessage="Duplicate options"
        errorId="options-error"
      />
      <p id="options-error">Duplicate options</p>
    </>,
  )
  for (const input of screen.getByRole('textbox').all()) {
    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    await expect.element(input).toHaveAccessibleDescription('Duplicate options')
  }
  await expect
    .element(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    .not.toHaveAttribute('aria-invalid')
  await screen.rerender(
    <>
      <ConfigSelect options={['First', 'Second']} onChange={vi.fn()} />
    </>,
  )
  for (const input of screen.getByRole('textbox').all()) {
    await expect.element(input).not.toHaveAttribute('aria-invalid')
    await expect.element(input).not.toHaveAttribute('aria-describedby')
  }
})

it('describes an empty-list error on the keyboard-reachable add action', async () => {
  const screen = await render(
    <>
      <ConfigSelect
        options={[]}
        onChange={vi.fn()}
        errorMessage="Add at least one option"
        errorId="options-error"
      />
      <p id="options-error">Add at least one option</p>
    </>,
  )
  const add = screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' })
  await userEvent.tab()
  await expect.element(add).toHaveFocus()
  await expect.element(add).toHaveAttribute('aria-invalid', 'true')
  await expect.element(add).toHaveAccessibleDescription('Add at least one option')
})

it.each(['{Enter}', ' '])(
  'adds an editable option with %s without submitting the enclosing form',
  async (key) => {
    const onSubmit = vi.fn((event: React.SubmitEvent) => event.preventDefault())
    const screen = await render(
      <form onSubmit={onSubmit}>
        <Options initial={[]} />
      </form>,
    )
    await userEvent.tab()
    await expect
      .element(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
      .toHaveFocus()
    await userEvent.keyboard(key)
    const input = screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' })
    await input.fill('New option')
    await expect.element(input).toHaveValue('New option')
    expect(onSubmit).not.toHaveBeenCalled()
  },
)

it('edits, removes, and adds options without losing the remaining value', async () => {
  const screen = await render(<Options />)
  const first = screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' })
  await first.fill('Updated option')
  await expect.element(first).toHaveValue('Updated option')
  await screen.getByRole('button', { name: 'common.operation.delete' }).first().click()
  await expect.element(first).toHaveValue('Second')
  await expect
    .element(screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }).click()
  await expect.element(first).toHaveValue('Second')
  const added = screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' })
  await added.fill('Last')
  await expect.element(added).toHaveValue('Last')
})

// Commit and pointer sorting are already exercised by keyboard-sortable.browser.spec.tsx.
it('cancels a duplicate-option reorder and restores native focus to its original handle', async () => {
  const screen = await render(<Options initial={['Same', 'Same', 'Last']} />)
  const handle = screen.getByRole('button', { name: /common\.sort\.handle.*Same/ }).nth(1)
  const values = () =>
    screen
      .getByRole('textbox')
      .elements()
      .map((input) => (input as HTMLInputElement).value)
  handle.element().focus()
  await userEvent.keyboard(' ')
  await expect.element(handle).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(values).toEqual(['Same', 'Last', 'Same'])
  await expect
    .element(screen.getByRole('button', { name: /common\.sort\.handle.*Same/ }).last())
    .toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.poll(values).toEqual(['Same', 'Same', 'Last'])
  await expect.element(handle).toHaveFocus()
  await expect.element(handle).toHaveAttribute('aria-pressed', 'false')
})
