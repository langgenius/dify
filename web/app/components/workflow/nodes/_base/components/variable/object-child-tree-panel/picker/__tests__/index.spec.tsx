import type { StructuredOutput } from '../../../../../../llm/types'
import { render, screen } from '@testing-library/react'
import { Type } from '../../../../../../llm/types'
import { PickerPanelMain } from '../index'

vi.mock('ahooks', () => ({
  useHover: vi.fn(),
}))

describe('PickerPanelMain', () => {
  const payload: StructuredOutput = {
    schema: {
      type: Type.object,
      additionalProperties: false,
      properties: {
        customer: {
          type: Type.object,
          properties: {
            displayName: { type: Type.string },
            metadata: {
              type: Type.object,
              properties: {
                orderId: { type: Type.string },
                irrelevantFlag: { type: Type.boolean },
              },
            },
          },
        },
        unrelatedRoot: { type: Type.string },
      },
    },
  }

  it('filters structured fields to the subtree matched by the search text', () => {
    render(
      <PickerPanelMain
        root={{ nodeId: 'node-a', nodeName: 'Node A', attrName: 'payload', attrAlias: 'object' }}
        payload={payload}
        searchText="order"
      />,
    )

    expect(screen.getByText('customer')).toBeInTheDocument()
    expect(screen.getByText('metadata')).toBeInTheDocument()
    expect(screen.getByText('orderId')).toBeInTheDocument()
    expect(screen.queryByText('displayName')).not.toBeInTheDocument()
    expect(screen.queryByText('irrelevantFlag')).not.toBeInTheDocument()
    expect(screen.queryByText('unrelatedRoot')).not.toBeInTheDocument()
  })
})
