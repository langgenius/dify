import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import VarReferenceVars from '../var-reference-vars'

describe('VarReferenceVars', () => {
  let keyboardTarget: HTMLInputElement
  const createVars = (vars: NodeOutPutVar[]) => vars

  beforeEach(() => {
    render(<input aria-label="Variable owner" />)
    keyboardTarget = screen.getByRole('textbox', { name: 'Variable owner' })
  })

  const baseVars = createVars([
    {
      title: 'Node A',
      nodeId: 'node-a',
      vars: [{ variable: 'valid_name', type: VarType.string }],
    },
  ])

  it('should filter, clear without leaving the search group, and close on escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onBlur = vi.fn()
    render(
      <VarReferenceVars vars={baseVars} onChange={vi.fn()} onClose={onClose} onBlur={onBlur} />,
    )

    const searchBox = screen.getByRole('searchbox', { name: 'workflow.common.searchVar' })
    await user.type(searchBox, 'valid')
    expect(screen.getByText('valid_name')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(searchBox).toHaveValue('')
    expect(searchBox).toHaveFocus()
    expect(onBlur).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should select the first visible variable by default and support arrow navigation in slash mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        hideSearch
        keyboardTarget={keyboardTarget}
        vars={createVars([
          {
            title: 'Node A',
            nodeId: 'node-a',
            vars: [
              { variable: 'first_value', type: VarType.string },
              { variable: 'second_value', type: VarType.string },
            ],
          },
        ])}
        onChange={onChange}
      />,
    )

    const firstItem = screen.getByText('first_value').closest('[data-selected]')
    const secondItem = screen.getByText('second_value').closest('[data-selected]')

    expect(firstItem).toHaveAttribute('data-selected', 'true')
    expect(secondItem).toHaveAttribute('data-selected', 'false')

    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    fireEvent.keyDown(keyboardTarget, { key: 'ArrowDown', isComposing: true })
    expect(firstItem).toHaveAttribute('data-selected', 'true')
    await user.click(keyboardTarget)
    await user.keyboard('{ArrowDown}')

    expect(firstItem).toHaveAttribute('data-selected', 'false')
    expect(secondItem).toHaveAttribute('data-selected', 'true')

    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith(
      ['node-a', 'second_value'],
      expect.objectContaining({
        variable: 'second_value',
      }),
    )
  })

  it('should render empty state and manage input action', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByText('pipeline.inputField.manage'))
    expect(onManageInputField).toHaveBeenCalledTimes(1)
  })

  it('should render special variable labels and schema types', () => {
    render(
      <VarReferenceVars
        hideSearch
        keyboardTarget={keyboardTarget}
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
        keyboardTarget={keyboardTarget}
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

    expect(screen.getByText('workflowDebug.debug.lastOutput')).toBeInTheDocument()
    expect(screen.getByText('current_prompt')).toBeInTheDocument()
  })

  it('should resolve selectors for special variables and file support', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        hideSearch
        keyboardTarget={keyboardTarget}
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

    await user.click(screen.getByText('API_KEY'))
    await user.click(screen.getByText('user_name'))
    await user.click(screen.getByText('current'))
    await user.click(screen.getByText('asset'))

    expect(onChange).toHaveBeenNthCalledWith(
      1,
      ['env', 'API_KEY'],
      expect.objectContaining({ variable: 'env.API_KEY' }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      ['conversation', 'user_name'],
      expect.objectContaining({ variable: 'conversation.user_name' }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      3,
      ['node-special', 'current'],
      expect.objectContaining({ variable: 'current' }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      4,
      ['node-special', 'asset'],
      expect.objectContaining({ variable: 'asset' }),
    )
  })

  it('should resolve selectors for special variables and file support from keyboard selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        hideSearch
        keyboardTarget={keyboardTarget}
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

    await user.click(keyboardTarget)
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenNthCalledWith(
      1,
      ['env', 'API_KEY'],
      expect.objectContaining({ variable: 'env.API_KEY' }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      ['conversation', 'user_name'],
      expect.objectContaining({ variable: 'conversation.user_name' }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      3,
      ['node-special', 'current'],
      expect.objectContaining({ variable: 'current' }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      4,
      ['node-special', 'asset'],
      expect.objectContaining({ variable: 'asset' }),
    )
  })

  it('selects both object roots and nested fields using their full node path', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        hideSearch
        keyboardTarget={keyboardTarget}
        vars={createVars([
          {
            title: 'Object vars',
            nodeId: 'node-obj',
            vars: [
              {
                variable: 'payload',
                type: VarType.object,
                children: [{ variable: 'child', type: VarType.string }],
              },
            ],
          },
        ])}
        onChange={onChange}
      />,
    )

    const root = screen.getByText('payload')
    await user.click(root)
    expect(onChange).toHaveBeenCalledWith(
      ['node-obj', 'payload'],
      expect.objectContaining({
        variable: 'payload',
      }),
    )
    await user.hover(root)
    await user.click(await screen.findByText('child'))
    expect(onChange).toHaveBeenLastCalledWith(
      ['node-obj', 'payload', 'child'],
      expect.objectContaining({ variable: 'payload' }),
    )
  })

  it('should filter by externally controlled search text and match child variables', () => {
    render(
      <VarReferenceVars
        hideSearch
        keyboardTarget={keyboardTarget}
        searchText="child"
        vars={createVars([
          {
            title: 'Object vars',
            nodeId: 'node-obj',
            vars: [
              {
                variable: 'payload',
                type: VarType.object,
                children: [{ variable: 'child_name', type: VarType.string }],
              },
              {
                variable: 'other_value',
                type: VarType.string,
              },
            ],
          },
        ])}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByPlaceholderText('workflow.common.searchVar')).not.toBeInTheDocument()
    expect(screen.getByText('payload')).toBeInTheDocument()
    expect(screen.queryByText('other_value')).not.toBeInTheDocument()
  })

  it('should ignore file vars when file support is disabled and notify when focus leaves the search group', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('searchbox'))
    await user.click(keyboardTarget)
    expect(onBlur).toHaveBeenCalledTimes(1)

    await user.click(screen.getByText('asset'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should ignore file vars when file support is disabled during keyboard selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <VarReferenceVars
        hideSearch
        keyboardTarget={keyboardTarget}
        vars={createVars([
          {
            title: 'Files',
            nodeId: 'node-files',
            vars: [{ variable: 'asset', type: VarType.file }],
          },
        ])}
        onChange={onChange}
      />,
    )

    await user.click(keyboardTarget)
    await user.keyboard('{Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })
})
