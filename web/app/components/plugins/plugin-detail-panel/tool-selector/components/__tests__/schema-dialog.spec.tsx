import type { Field } from '@/app/components/workflow/nodes/llm/types'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaDialog } from '../schema-dialog'

const objectSchema = {
  type: 'object',
  properties: {
    address: {
      type: 'object',
      properties: { city: { type: 'string', description: 'Destination city' } },
      required: ['city'],
    },
  },
  additionalProperties: false,
} satisfies Field

const arraySchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      entry: {
        type: 'object',
        properties: { quantity: { type: 'number' } },
        required: ['quantity'],
      },
    },
  },
} satisfies Field

const dialogName = 'workflowAgent.nodes.agent.parameterSchema'
const compactName = 'workflowAgent.nodes.agent.clickToViewParameterSchema: response'

describe('SchemaDialog', () => {
  it('keeps nested object and array fields read-only while supporting keyboard collapse', async () => {
    const user = userEvent.setup()
    render(
      <SchemaDialog
        schema={{ type: 'object', properties: { ...objectSchema.properties, list: arraySchema } }}
        rootName="response"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'JSON Schema: response' }))
    const dialog = await screen.findByRole('dialog', { name: dialogName })

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.mouseEnter(within(dialog).getByText('city'))
      act(() => vi.advanceTimersByTime(60))
      expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
      fireEvent.mouseEnter(within(dialog).getByText('quantity'))
      act(() => vi.advanceTimersByTime(60))
      expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }

    const address = within(dialog).getByRole('button', { name: 'address' })
    expect(address).toHaveAttribute('aria-expanded', 'true')
    address.focus()
    await user.keyboard('{Enter}')
    expect(address).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByText('city')).not.toBeInTheDocument()
    await user.keyboard(' ')
    expect(address).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText('city')).toBeInTheDocument()
  })

  it.each([undefined, null])('keeps a missing schema (%s) entry disabled', async (schema) => {
    const user = userEvent.setup()
    const { rerender } = render(<SchemaDialog schema={schema} rootName="response" />)
    const trigger = screen.getByRole('button', { name: 'JSON Schema: response' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<SchemaDialog schema={schema} rootName="response" compact />)
    expect(screen.getByRole('button', { name: compactName })).toBeDisabled()
  })
})
