import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { VarType } from '@/app/components/workflow/types'
import VarReferenceVars from '../var-reference-vars'

vi.mock('../object-child-tree-panel/picker', () => ({
  default: ({
    onHovering,
    onSelect,
  }: {
    onHovering?: (value: boolean) => void
    onSelect?: (value: string[]) => void
  }) => (
    <div>
      <button onMouseEnter={() => onHovering?.(true)} onMouseLeave={() => onHovering?.(false)}>
        picker-panel
      </button>
      <button onClick={() => onSelect?.(['node-obj', 'payload', 'child'])}>pick-child</button>
    </div>
  ),
}))

vi.mock('../manage-input-field', () => ({
  default: ({ onManage }: { onManage: () => void }) => <button onClick={onManage}>manage-input</button>,
}))

describe('VarReferenceVars', () => {
  const createVars = (vars: NodeOutPutVar[]) => vars

  const baseVars = createVars([{
    title: 'Node A',
    nodeId: 'node-a',
    vars: [{ variable: 'valid_name', type: VarType.string }],
  }])

  it('should filter vars through the search box and call onClose on escape', () => {
    const onClose = vi.fn()
    render(
      <VarReferenceVars
        vars={baseVars}
        onChange={vi.fn()}
        onClose={onClose}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('workflow.common.searchVar'), {
      target: { value: 'valid' },
    })
    expect(screen.getByText('valid_name')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByPlaceholderText('workflow.common.searchVar'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should call onChange when a variable item is chosen', () => {
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        vars={baseVars}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('valid_name'))

    expect(onChange).toHaveBeenCalledWith(['node-a', 'valid_name'], expect.objectContaining({
      variable: 'valid_name',
    }))
  })

  it('should render empty state and manage input action', () => {
    const onManageInputField = vi.fn()

    render(
      <VarReferenceVars
        vars={[]}
        onChange={vi.fn()}
        showManageInputField
        onManageInputField={onManageInputField}
      />,
    )

    expect(screen.getByText('workflow.common.noVar')).toBeInTheDocument()

    fireEvent.click(screen.getByText('manage-input'))
    expect(onManageInputField).toHaveBeenCalledTimes(1)
  })

  it('should render special variable labels and schema types', () => {
    render(
      <VarReferenceVars
        hideSearch
        preferSchemaType
        vars={createVars([
          {
            title: 'Specials',
            nodeId: 'node-special',
            vars: [
              { variable: 'env.API_KEY', type: VarType.string, schemaType: 'secret' },
              { variable: 'conversation.user_name', type: VarType.string, des: 'User name' },
              { variable: 'retrieval.source.title', type: VarType.string, isRagVariable: true },
            ],
          },
        ])}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByPlaceholderText('workflow.common.searchVar')).not.toBeInTheDocument()
    expect(screen.getByText('API_KEY')).toBeInTheDocument()
    expect(screen.getByText('user_name')).toBeInTheDocument()
    expect(screen.getByText('secret')).toBeInTheDocument()
  })

  it('should render flat vars and the last output separator', () => {
    render(
      <VarReferenceVars
        hideSearch
        vars={createVars([
          {
            title: 'Flat',
            nodeId: 'node-flat',
            isFlat: true,
            vars: [{ variable: 'current', type: VarType.string }],
          },
          {
            title: 'Node B',
            nodeId: 'node-b',
            vars: [{ variable: 'payload', type: VarType.string }],
          },
        ])}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.debug.lastOutput')).toBeInTheDocument()
    expect(screen.getByText('current_prompt')).toBeInTheDocument()
  })

  it('should resolve selectors for special variables and file support', () => {
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        hideSearch
        isSupportFileVar
        vars={createVars([
          {
            title: 'Specials',
            nodeId: 'node-special',
            vars: [
              { variable: 'env.API_KEY', type: VarType.string },
              { variable: 'conversation.user_name', type: VarType.string, des: 'User name' },
              { variable: 'current', type: VarType.string },
              { variable: 'asset', type: VarType.file },
            ],
          },
        ])}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('API_KEY'))
    fireEvent.click(screen.getByText('user_name'))
    fireEvent.click(screen.getByText('current'))
    fireEvent.click(screen.getByText('asset'))

    expect(onChange).toHaveBeenNthCalledWith(1, ['env', 'API_KEY'], expect.objectContaining({ variable: 'env.API_KEY' }))
    expect(onChange).toHaveBeenNthCalledWith(2, ['conversation', 'user_name'], expect.objectContaining({ variable: 'conversation.user_name' }))
    expect(onChange).toHaveBeenNthCalledWith(3, ['node-special', 'current'], expect.objectContaining({ variable: 'current' }))
    expect(onChange).toHaveBeenNthCalledWith(4, ['node-special', 'asset'], expect.objectContaining({ variable: 'asset' }))
  })

  it('should render object vars and select them by node path', () => {
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        hideSearch
        vars={createVars([
          {
            title: 'Object vars',
            nodeId: 'node-obj',
            vars: [{
              variable: 'payload',
              type: VarType.object,
              children: [{ variable: 'child', type: VarType.string }],
            }],
          },
        ])}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('payload'))
    expect(onChange).toHaveBeenCalledWith(['node-obj', 'payload'], expect.objectContaining({
      variable: 'payload',
    }))
  })

  it('should ignore file vars when file support is disabled and forward blur-sm events', () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()

    render(
      <VarReferenceVars
        vars={createVars([
          {
            title: 'Files',
            nodeId: 'node-files',
            vars: [{ variable: 'asset', type: VarType.file }],
          },
        ])}
        onChange={onChange}
        onBlur={onBlur}
      />,
    )

    fireEvent.blur(screen.getByPlaceholderText('workflow.common.searchVar'))
    expect(onBlur).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('asset'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
