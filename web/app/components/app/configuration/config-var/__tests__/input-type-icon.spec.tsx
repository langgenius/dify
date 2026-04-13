import { render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import InputTypeIcon from '../input-type-icon'

const mockInputVarTypeIcon = vi.fn(({ type, className }: { type: InputVarType, className?: string }) => (
  <div data-testid="input-var-type-icon" data-type={type} className={className} />
))

vi.mock('@/app/components/workflow/nodes/_base/components/input-var-type-icon', () => ({
  default: (props: { type: InputVarType, className?: string }) => mockInputVarTypeIcon(props),
}))

describe('InputTypeIcon', () => {
  it('should map string variables to the workflow text-input icon', () => {
    render(<InputTypeIcon type="string" className="marker" />)

    expect(screen.getByTestId('input-var-type-icon')).toHaveAttribute('data-type', InputVarType.textInput)
    expect(screen.getByTestId('input-var-type-icon')).toHaveClass('marker')
  })

  it('should map select variables to the workflow select icon', () => {
    render(<InputTypeIcon type="select" className="marker" />)

    expect(screen.getByTestId('input-var-type-icon')).toHaveAttribute('data-type', InputVarType.select)
  })
})
