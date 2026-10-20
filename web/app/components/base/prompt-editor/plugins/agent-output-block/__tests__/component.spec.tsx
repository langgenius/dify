import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { OutputEditorProps } from './test-helpers'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutputEditor } from './test-helpers'

const outputs: DeclaredOutputConfig[] = [{ name: 'output', type: 'string', required: false }]
const nameInput = () =>
  screen.getByRole('textbox', {
    name: 'workflowAgent.nodes.agent.outputVars.nameLabel',
  }) as HTMLInputElement
const typeSelect = () =>
  screen.getByRole('combobox', { name: 'workflowAgent.nodes.agent.outputVars.typeLabel' })

function renderOutput({ onChange = vi.fn(), onEdit = vi.fn(), ...props }: OutputEditorProps = {}) {
  return {
    onChange,
    onEdit,
    ...render(<OutputEditor {...props} onChange={onChange} onEdit={onEdit} />),
  }
}

describe('AgentOutputBlockComponent with Lexical', () => {
  it.each([true, false])('focuses the name with selectNameOnEdit=%s', async (selectNameOnEdit) => {
    renderOutput({ selectNameOnEdit })
    await waitFor(() => expect(nameInput()).toHaveFocus())
    expect(nameInput().selectionStart).toBe(selectNameOnEdit ? 0 : 'output'.length)
    expect(nameInput().selectionEnd).toBe('output'.length)
  })

  it('keeps typing local and commits both the node and prompt on blur', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await screen.findByRole('textbox', { name: 'workflowAgent.nodes.agent.outputVars.nameLabel' })
    await user.clear(nameInput())
    await user.type(nameInput(), 'summary')
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Outside editor' }))

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledExactlyOnceWith(
        [{ name: 'summary', type: 'string', required: false }],
        'Generate [§output:summary:summary§] after',
      ),
    )
    expect(
      screen.queryByRole('textbox', { name: 'workflowAgent.nodes.agent.outputVars.nameLabel' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('summary')).toBeVisible()
  })

  it('keeps editing through Tab and commits the chosen output type', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await screen.findByRole('textbox', { name: 'workflowAgent.nodes.agent.outputVars.nameLabel' })
    await user.clear(nameInput())
    await user.type(nameInput(), 'summary')
    await user.tab()
    await waitFor(() => expect(typeSelect()).toHaveAttribute('aria-expanded', 'true'))
    expect(nameInput()).toHaveValue('summary')
    await user.click(await screen.findByRole('option', { name: 'file' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ name: 'summary', type: 'file' })],
        'Generate [§output:summary:summary§] after',
      ),
    )
    expect(screen.getByText('file')).toBeVisible()
  })

  it('commits a draft name with its type without an intermediate blur save', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await screen.findByRole('textbox', { name: 'workflowAgent.nodes.agent.outputVars.nameLabel' })
    await user.clear(nameInput())
    await user.type(nameInput(), 'summary')
    await user.click(typeSelect())
    expect(onChange).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('option', { name: 'file' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledExactlyOnceWith(
        [expect.objectContaining({ name: 'summary', type: 'file' })],
        'Generate [§output:summary:summary§] after',
      ),
    )
  })

  it.each(['qna_report.pdf', 'existing'])(
    'rejects an invalid or duplicate output name: %s',
    async (name) => {
      const user = userEvent.setup()
      const { onChange } = renderOutput({
        declaredOutputs: [...outputs, { name: 'existing', type: 'string', required: false }],
      })
      await screen.findByRole('textbox', { name: 'workflowAgent.nodes.agent.outputVars.nameLabel' })
      await user.clear(nameInput())
      await user.type(nameInput(), `${name}{Enter}`)
      expect(nameInput()).toHaveValue('output')
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('requests editing a committed block with the keyboard', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderOutput({ isEditing: false })
    const block = await screen.findByRole('button', { name: /outputVars.edit/ })
    block.focus()
    await user.keyboard('{Enter}')
    expect(onEdit).toHaveBeenCalledExactlyOnceWith('output', 'string')
  })
})
