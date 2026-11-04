import type { Inputs, PromptVariable } from '@/models/debug'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import DebugConfigurationContext from '@/context/debug-configuration'
import { renderWithDebugConfiguration } from '@/test/debug-configuration'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import ChatUserInput from '../chat-user-input'

const variable = (overrides: Partial<PromptVariable> = {}): PromptVariable => ({
  key: 'name',
  name: 'Name',
  type: 'string',
  required: true,
  ...overrides,
})
const modelConfig = (variables: PromptVariable[]) =>
  createModelConfigFixture({
    configs: { prompt_template: '', prompt_variables: variables },
  })

function renderInputs(
  variables: PromptVariable[],
  initialInputs: Inputs = {},
  permissions = { readonly: false, canTestAndRun: true },
) {
  const onChange = vi.fn()
  function Form() {
    const [inputs, setInputs] = useState(initialInputs)
    const value = createDebugConfigurationFixture({
      ...permissions,
      modelConfig: modelConfig(variables),
      setInputs: (nextInputs) => {
        onChange(nextInputs)
        setInputs(nextInputs)
      },
    })
    return (
      <DebugConfigurationContext.Provider value={value}>
        <ChatUserInput inputs={inputs} />
      </DebugConfigurationContext.Provider>
    )
  }
  return { ...render(<Form />), onChange }
}

describe('ChatUserInput', () => {
  it('omits variables without a usable key or name', () => {
    const { container } = renderInputs([
      variable({ key: '' }),
      variable({ key: '   ' }),
      variable({ name: '' }),
      variable({ name: '   ' }),
    ])
    expect(container).toBeEmptyDOMElement()
  })

  it('renders no form without prompt variables', () => {
    const { container } = renderInputs([])
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    {
      type: 'string',
      role: 'textbox',
      previous: 'Old name',
      next: 'New name',
      expected: 'New name',
    },
    {
      type: 'paragraph',
      role: 'textbox',
      previous: 'Old description',
      next: 'New description',
      expected: 'New description',
    },
    { type: 'number', role: 'spinbutton', previous: 42, next: '100', expected: '100' },
  ])(
    'edits $type values while preserving other inputs',
    async ({ type, role, previous, next, expected }) => {
      const user = userEvent.setup()
      const { onChange } = renderInputs([variable({ type })], {
        name: previous,
        other: 'preserved',
      })
      const input = screen.getByRole(role, { name: 'Name' })
      expect(input).toHaveValue(previous)
      await user.clear(input)
      await user.type(input, next)
      expect(onChange).toHaveBeenLastCalledWith({ name: expected, other: 'preserved' })
    },
  )

  it('changes the selected option and preserves other inputs', async () => {
    const user = userEvent.setup()
    const { onChange } = renderInputs([variable({ type: 'select', options: ['A', 'B', 'C'] })], {
      name: 'A',
      other: 'preserved',
    })
    const select = screen.getByRole('combobox', { name: 'Name' })
    expect(select).toHaveTextContent('A')
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'B' }))
    expect(select).toHaveTextContent('B')
    expect(onChange).toHaveBeenLastCalledWith({ name: 'B', other: 'preserved' })
  })

  it('toggles a boolean in both directions', async () => {
    const user = userEvent.setup()
    const { onChange } = renderInputs([variable({ type: 'checkbox' })], { name: false })
    const checkbox = screen.getByRole('checkbox', { name: 'Name' })
    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith({ name: true })
    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith({ name: false })
  })

  it.each([true, false])(
    'shows the optional hint only for optional fields (required=%s)',
    (required) => {
      renderInputs([variable({ required })])
      const hint = screen.queryByText(/(?:^|\.)panel\.optional(?=$|:)/)
      if (required) expect(hint).not.toBeInTheDocument()
      else expect(hint).toBeVisible()
    },
  )

  it('allows test input despite readonly configuration when test/run is permitted', async () => {
    const user = userEvent.setup()
    const { onChange } = renderInputs([variable()], {}, { readonly: true, canTestAndRun: true })
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ada')
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Ada' })
  })

  it.each([true, false])(
    'blocks input without test/run permission regardless of configuration readonly=%s',
    async (readonly) => {
      const user = userEvent.setup()
      const { onChange } = renderInputs(
        [
          variable(),
          variable({ key: 'description', name: 'Description', type: 'paragraph' }),
          variable({ key: 'count', name: 'Count', type: 'number' }),
          variable({ key: 'choice', name: 'Choice', type: 'select', options: ['A'] }),
          variable({ key: 'enabled', name: 'Enabled', type: 'checkbox' }),
        ],
        {},
        { readonly, canTestAndRun: false },
      )
      for (const input of screen.getAllByRole('textbox')) {
        expect(input).toHaveAttribute('readonly')
        await user.type(input, 'blocked')
      }
      expect(screen.getByRole('spinbutton', { name: 'Count' })).toHaveAttribute('readonly')
      expect(screen.getByRole('combobox', { name: 'Choice' })).toBeDisabled()
      const checkbox = screen.getByRole('checkbox', { name: 'Enabled' })
      expect(checkbox).toHaveAttribute('aria-disabled', 'true')
      await user.click(checkbox)
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('initializes missing and empty values together without replacing existing values', () => {
    const setInputs = vi.fn()
    renderWithDebugConfiguration(<ChatUserInput inputs={{ existing: 'Keep', empty: '' }} />, {
      modelConfig: modelConfig([
        variable({ key: 'name', default: 'Default Name' }),
        variable({ key: 'empty', default: 'Filled' }),
        variable({ key: 'existing', default: 'Replace' }),
        variable({ key: 'count', type: 'number', default: 0 }),
        variable({ key: 'enabled', type: 'checkbox', default: false }),
      ]),
      setInputs,
    })
    expect(setInputs).toHaveBeenCalledWith({
      existing: 'Keep',
      empty: 'Filled',
      name: 'Default Name',
      count: 0,
      enabled: false,
    })
  })

  it('does not update populated values or fields without defaults', () => {
    const { onChange } = renderInputs(
      [
        variable({ default: '' }),
        variable({ key: 'missing' }),
        variable({ key: 'existing', default: 'Replace' }),
      ],
      { existing: 'Keep' },
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('enforces the configured text length during editing', async () => {
    const user = userEvent.setup()
    const { onChange } = renderInputs([variable({ max_length: 5 })])
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '123456')
    expect(onChange).toHaveBeenLastCalledWith({ name: '12345' })
  })

  it('shows no options when a select has no configured choices', async () => {
    const user = userEvent.setup()
    renderInputs([variable({ type: 'select', options: [] })])
    await user.click(screen.getByRole('combobox', { name: 'Name' }))
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('displays numeric values in a string field', () => {
    renderInputs([variable()], { name: 123 })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('123')
  })
})
