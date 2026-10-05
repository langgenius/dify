import type { Field } from '@/app/components/workflow/nodes/llm/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const cases = [
  { schema: objectSchema, childName: 'city', typeName: 'object' },
  { schema: arraySchema, childName: 'quantity', typeName: 'array[object]' },
]

describe('SchemaDialog', () => {
  afterEach(() => vi.useRealTimers())
  it.each(cases)(
    'inspects $typeName with the real tree and returns focus after closing',
    async ({ schema, childName, typeName }) => {
      const user = userEvent.setup()
      render(<SchemaDialog schema={schema} rootName="response" />)
      const trigger = screen.getByRole('button', { name: 'JSON Schema: response' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.click(trigger)
      const dialog = await screen.findByRole('dialog', { name: dialogName })
      expect(within(dialog).getByText('response')).toBeInTheDocument()
      expect(within(dialog).getAllByText(typeName).length).toBeGreaterThan(0)
      expect(within(dialog).getByText(childName)).toBeInTheDocument()
      expect(
        within(dialog).getByText('workflowModels.nodes.llm.jsonSchema.required'),
      ).toBeInTheDocument()
      expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(trigger).toHaveFocus())
    },
  )

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

  it('uses the fixed compact entry and resets inspection expansion on reopen', async () => {
    const user = userEvent.setup()
    render(<SchemaDialog schema={objectSchema} rootName="response" compact />)
    const trigger = screen.getByRole('button', { name: compactName })
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: dialogName })
    await user.click(within(dialog).getByRole('button', { name: 'address' }))
    expect(within(dialog).queryByText('city')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.keyboard(' ')
    const reopened = await screen.findByRole('dialog', { name: dialogName })
    expect(within(reopened).getByText('city')).toBeInTheDocument()
  })

  it('shows the existing primitive array type without inventing object fields', async () => {
    const user = userEvent.setup()
    render(<SchemaDialog schema={{ type: 'array', items: { type: 'string' } }} rootName="names" />)
    await user.click(screen.getByRole('button', { name: 'JSON Schema: names' }))
    const dialog = await screen.findByRole('dialog', { name: dialogName })
    expect(within(dialog).getByText('names')).toBeInTheDocument()
    expect(within(dialog).getByText('array[string]')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button')).toHaveLength(1)
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

  it('ends an unavailable session and permits a fresh preview when schema returns', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SchemaDialog schema={objectSchema} rootName="response" />)
    await user.click(screen.getByRole('button', { name: 'JSON Schema: response' }))
    await screen.findByRole('dialog', { name: dialogName })
    rerender(<SchemaDialog schema={null} rootName="response" />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'JSON Schema: response' })).toBeDisabled()
    rerender(<SchemaDialog schema={arraySchema} rootName="rows" />)
    await user.click(screen.getByRole('button', { name: 'JSON Schema: rows' }))
    const reopened = await screen.findByRole('dialog', { name: dialogName })
    expect(within(reopened).getByText('rows')).toBeInTheDocument()
    expect(within(reopened).getByText('quantity')).toBeInTheDocument()
    expect(within(reopened).queryByText('city')).not.toBeInTheDocument()
  })
})
