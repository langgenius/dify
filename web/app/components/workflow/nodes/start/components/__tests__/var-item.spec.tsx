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

  it('shows the default value under the field name when one is set', () => {
    render(
      <VarItem
        readonly
        payload={createPayload({
          default: 'langgenius/dify-official-plugins-and-extensions',
          required: true,
        })}
      />,
    )

    const defaultLine = screen.getByTitle('langgenius/dify-official-plugins-and-extensions')
    expect(defaultLine).toHaveTextContent(
      'workflow.nodes.start.default: langgenius/dify-official-plugins-and-extensions',
    )
    expect(screen.getByText('workflow.nodes.start.required')).toBeInTheDocument()
  })

  it('hides the default line when no default value is set', () => {
    render(<VarItem readonly payload={createPayload({ required: false })} />)

    expect(screen.queryByText(/workflow\.nodes\.start\.default:/)).not.toBeInTheDocument()
  })

  it('shows boolean false defaults', () => {
    render(
      <VarItem readonly payload={createPayload({ type: InputVarType.checkbox, default: false })} />,
    )

    expect(screen.getByTitle('false')).toHaveTextContent('workflow.nodes.start.default: false')
  })
})
