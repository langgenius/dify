/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen } from '@testing-library/react'
import TypeSelector from '../type-select'

vi.mock('@langgenius/dify-ui/select', () => import('@/__mocks__/base-ui-select'))

vi.mock('@/app/components/workflow/nodes/_base/components/input-var-type-icon', () => ({
  default: ({ type }: { type: string }) => <span>{type}</span>,
}))

describe('TypeSelector', () => {
  it('should toggle open state and select a new variable type', () => {
    const onSelect = vi.fn()

    render(
      <TypeSelector
        value="text-input"
        onSelect={onSelect}
        items={[
          { value: 'text-input' as any, name: 'Text' },
          { value: 'number' as any, name: 'Number' },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Number'))

    expect(onSelect).toHaveBeenCalledWith({ value: 'number', name: 'Number' })
  })
})
