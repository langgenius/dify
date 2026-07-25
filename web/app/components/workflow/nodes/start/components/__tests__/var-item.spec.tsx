import type { InputVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import VarItem from '../var-item'

vi.mock('@/app/components/app/configuration/config-var/config-modal', () => ({
  __esModule: true,
  default: ({ isShow }: { isShow: boolean }) =>
    isShow ? <div role="dialog">edit-variable</div> : null,
}))

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Query',
  variable: 'query',
  type: InputVarType.textInput,
  required: false,
  ...overrides,
})

describe('StartVarItem', () => {
  it('shows named edit and remove actions on hover', () => {
    const handleRemove = vi.fn()
    const { container } = render(
      <VarItem readonly={false} payload={createPayload()} onRemove={handleRemove} />,
    )

    fireEvent.mouseEnter(container.firstElementChild!)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('edit-variable')

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(handleRemove).toHaveBeenCalledTimes(1)
  })

  it('renders the default value indicator when a field has a default', () => {
    render(<VarItem readonly={false} payload={createPayload({ default: 'hello' })} />)

    const value = screen.getByTestId('var-item-default-value')
    expect(value).toHaveTextContent('hello')
    expect(value).toHaveAttribute('title', 'hello')
  })

  it('renders no default indicator when a field has no default', () => {
    render(<VarItem readonly={false} payload={createPayload()} />)

    expect(screen.queryByTestId('var-item-default-value')).toBeNull()
  })

  it('truncates a long default while keeping the full value in the tooltip', () => {
    const longDefault = 'x'.repeat(200)
    render(<VarItem readonly={false} payload={createPayload({ default: longDefault })} />)

    const value = screen.getByTestId('var-item-default-value')
    // Full value is preserved for the hover tooltip...
    expect(value).toHaveAttribute('title', longDefault)
    // ...while the visible text is clipped via the truncate utility, keeping row height fixed.
    expect(value).toHaveClass('truncate')
  })
})
