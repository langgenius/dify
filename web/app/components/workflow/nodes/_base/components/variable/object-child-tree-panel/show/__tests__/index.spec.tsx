import { fireEvent, render, screen } from '@testing-library/react'
import ShowPanel from '../index'

it('keeps known object fields, descriptions, enums, file markers and collapse behavior', () => {
  const { container } = render(
    <ShowPanel
      payload={{
        schema: {
          properties: {
            result: {
              type: 'object',
              required: ['title'],
              description: 'Result details',
              properties: {
                title: { type: 'string', description: 'The title' },
                names: { type: 'array', items: { type: 'string' } },
                state: { type: 'string', enum: ['ready', 'done'] },
                document: { type: 'object', schemaType: 'file' },
              },
            },
          },
        },
      }}
    />,
  )
  expect(screen.getByText('The title')).toBeInTheDocument()
  expect(screen.getByText('app.structOutput.required')).toBeInTheDocument()
  expect(screen.getByText('array[string]')).toBeInTheDocument()
  expect(screen.getByText('"ready" |')).toBeInTheDocument()
  expect(screen.getByText('file')).toBeInTheDocument()
  const collapse = container.querySelector('svg')
  expect(collapse).not.toBeNull()
  fireEvent.click(collapse!)
  expect(screen.queryByText('title')).not.toBeInTheDocument()
  expect(screen.getByText('Result details')).toBeInTheDocument()
  fireEvent.click(collapse!)
  expect(screen.getByText('title')).toBeInTheDocument()
})

it('renders unknown boolean, nullable and untyped nested schema fields without throwing', () => {
  render(
    <ShowPanel
      payload={{
        schema: {
          properties: {
            allowed: true,
            blocked: false,
            nullable: null,
            untyped: {},
            empty: { type: '' },
            nested: { type: 'object', properties: { child: null } },
          },
        },
      }}
    />,
  )
  expect(screen.getAllByText('Unknown')).toHaveLength(6)
  for (const name of ['allowed', 'blocked', 'nullable', 'untyped', 'empty', 'child'])
    expect(screen.getByText(name)).toBeInTheDocument()
})

it.each([null, true, [], { properties: null }, { properties: false }])(
  'safely ignores a schema with no properties: %j',
  (schema) => {
    const { container } = render(<ShowPanel payload={{ schema }} />)
    expect(container).toBeEmptyDOMElement()
  },
)
