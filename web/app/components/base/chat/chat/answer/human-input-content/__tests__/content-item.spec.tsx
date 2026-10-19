import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import ContentItem from '../content-item'

const fields: ComponentProps<typeof ContentItem>['formInputFields'] = [
  {
    type: InputVarType.paragraph,
    output_variable_name: 'bio',
    default: { type: 'constant', value: '', selector: [] },
  },
  {
    type: InputVarType.select,
    output_variable_name: 'decision',
    option_source: { type: 'constant', value: ['approve', 'reject'], selector: [] },
  },
]

it('renders literal Markdown content', async () => {
  render(
    <ContentItem
      content="**Hello** [guide](https://example.com/guide)"
      formInputFields={fields}
      inputs={{}}
      onInputChange={vi.fn()}
    />,
  )
  expect(await screen.findByRole('link', { name: 'guide' })).toHaveAttribute(
    'href',
    'https://example.com/guide',
  )
  expect(screen.getByText('Hello')).toBeInTheDocument()
})

it('routes real text and select edits to their named fields without replacing other input values', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const Form = () => {
    const [inputs, setInputs] = useState({ bio: 'Initial bio', decision: 'approve' })
    return (
      <>
        {fields.map((field) => (
          <ContentItem
            key={field.output_variable_name}
            content={`{{#$output.${field.output_variable_name}#}}`}
            formInputFields={fields}
            inputs={inputs}
            onInputChange={(name, value) => {
              onChange(name, value)
              setInputs((previous) => ({ ...previous, [name]: value }))
            }}
          />
        ))}
      </>
    )
  }
  render(<Form />)
  const bio = screen.getByRole('textbox', { name: 'bio' })
  await user.clear(bio)
  await user.type(bio, 'Updated bio')
  await user.click(screen.getByRole('combobox', { name: 'decision' }))
  await user.click(await screen.findByRole('option', { name: 'reject' }))
  expect(onChange).toHaveBeenCalledWith('bio', 'Updated bio')
  expect(onChange).toHaveBeenLastCalledWith('decision', 'reject')
  expect(bio).toHaveValue('Updated bio')
  expect(screen.getByRole('combobox', { name: 'decision' })).toHaveTextContent('reject')
})

it('omits placeholders for fields that no longer exist', () => {
  const { container } = render(
    <ContentItem
      content="{{#$output.removed#}}"
      formInputFields={fields}
      inputs={{ removed: 'old value' }}
      onInputChange={vi.fn()}
    />,
  )
  expect(container).toBeEmptyDOMElement()
})
