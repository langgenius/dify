import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { VarType } from '@/app/components/workflow/types'
import ExtractInput from '../extract-input'

type MockInputProps = {
  className: string
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Array<{ id: string }>
  onFocusChange?: (value: boolean) => void
  placeholder?: string
}

const mockUseAvailableVarList = vi.fn()
const mockInput = vi.fn<(props: MockInputProps) => void>()

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: (props: MockInputProps) => {
    mockInput(props)
    return (
      <div data-testid="extract-input" data-class-name={props.className} data-placeholder={props.placeholder || ''}>
        <button type="button" onClick={() => props.onFocusChange?.(true)}>focus</button>
        <button type="button" onClick={() => props.onFocusChange?.(false)}>blur</button>
        <button type="button" onClick={() => props.onChange('12')}>change</button>
      </div>
    )
  },
}))

describe('list-operator/extract-input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableVarList.mockImplementation((_nodeId: string, options?: {
      filterVar?: (payload: { type: VarType }) => boolean
    }) => {
      const numberVars: NodeOutPutVar[] = [{
        nodeId: 'number-node',
        title: 'Numbers',
        vars: [{
          variable: 'count',
          type: VarType.number,
        }],
      }]
      const stringVars: NodeOutPutVar[] = [{
        nodeId: 'text-node',
        title: 'Texts',
        vars: [{
          variable: 'name',
          type: VarType.string,
        }],
      }]

      const allVars = [...numberVars, ...stringVars]
      return {
        availableVars: allVars.filter(item => item.vars.every(variable => options?.filterVar?.({ type: variable.type }) ?? true)),
        availableNodesWithParent: [{ id: 'number-node' }],
      }
    })
  })

  it('should filter variables to numeric values and toggle focus styles', () => {
    const handleChange = vi.fn()
    render(
      <ExtractInput
        nodeId="node-1"
        readOnly={false}
        value="5"
        onChange={handleChange}
      />,
    )

    expect(mockInput.mock.calls[0]![0]).toMatchObject({
      readOnly: false,
      value: '5',
      placeholder: 'workflow.nodes.http.extractListPlaceholder',
      nodesOutputVars: [{
        nodeId: 'number-node',
        title: 'Numbers',
        vars: [expect.objectContaining({ variable: 'count' })],
      }],
      availableNodes: [{ id: 'number-node' }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'focus' }))
    expect(screen.getByTestId('extract-input').dataset.className).toContain('border-components-input-border-active')

    fireEvent.click(screen.getByRole('button', { name: 'change' }))
    expect(handleChange).toHaveBeenCalledWith('12')

    fireEvent.click(screen.getByRole('button', { name: 'blur' }))
    expect(screen.getByTestId('extract-input').dataset.className).toContain('border-components-input-border-hover')
  })

  it('should clear the placeholder when the component is readonly', () => {
    render(
      <ExtractInput
        nodeId="node-1"
        readOnly
        value=""
        onChange={vi.fn()}
      />,
    )

    expect(mockInput.mock.calls[0]![0].placeholder).toBe('')
    expect(mockInput.mock.calls[0]![0].readOnly).toBe(true)
  })
})
