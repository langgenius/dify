import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { routeFetchTo } from '@/test/console/fetch'
import useMatchSchemaType, { getMatchedSchemaType } from '../use-match-schema-type'

// Built-in definitions as served by /spec/schema-definitions (api/core/schemas/builtin).
const schemaDefinitions = [
  {
    name: 'file',
    label: 'File',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        size: { type: 'number' },
        extension: { type: 'string' },
        type: { type: 'string' },
        mime_type: { type: 'string' },
        transfer_method: { type: 'string' },
        url: { type: 'string' },
        related_id: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'general_structure',
    label: 'General Structure',
    schema: {
      type: 'array',
      items: { type: 'string' },
    },
  },
]

routeFetchTo(async () => Response.json(schemaDefinitions))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
)

describe('useMatchSchemaType', () => {
  it('keeps the full definition schemas so typed structures still match', async () => {
    const { result } = renderHook(() => useMatchSchemaType(), { wrapper })

    await waitFor(() => expect(result.current.schemaTypeDefinitions).toBeDefined())
    const definitions = result.current.schemaTypeDefinitions

    expect(
      getMatchedSchemaType(
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            size: { type: 'number' },
            extension: { type: 'string' },
            type: { type: 'string' },
            mime_type: { type: 'string' },
            transfer_method: { type: 'string' },
            url: { type: 'string' },
            related_id: { type: 'string' },
          },
        },
        definitions,
      ),
    ).toBe('file')
    expect(getMatchedSchemaType({ type: 'array', items: { type: 'string' } }, definitions)).toBe(
      'general_structure',
    )
    expect(getMatchedSchemaType({ type: 'object', properties: {} }, definitions)).toBe('')
  })
})
