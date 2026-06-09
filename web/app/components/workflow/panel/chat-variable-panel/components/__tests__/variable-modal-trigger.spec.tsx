import type { ConversationVariable } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '../../type'
import VariableModalTrigger from '../variable-modal-trigger'

vi.mock('uuid', () => ({
  v4: () => 'generated-id',
}))

const createVariable = (overrides: Partial<ConversationVariable> = {}): ConversationVariable => ({
  id: 'var-1',
  name: 'conversation_var',
  description: 'Conversation scoped variable',
  value_type: ChatVarType.String,
  value: '',
  ...overrides,
})

describe('VariableModalTrigger', () => {
  it('opens from the trigger when initially closed', async () => {
    const user = userEvent.setup()
    const setOpen = vi.fn()
    const onClose = vi.fn()

    renderWorkflowComponent(
      <VariableModalTrigger
        open={false}
        setOpen={setOpen}
        showTip
        onClose={onClose}
        onSave={vi.fn()}
      />,
    )

    expect(screen.queryByPlaceholderText('workflow.chatVariable.modal.namePlaceholder')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.chatVariable.button' }))

    expect(setOpen).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saves through the real modal and closes the trigger', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn()
    const setOpen = vi.fn()

    renderWorkflowComponent(
      <VariableModalTrigger
        open
        setOpen={setOpen}
        showTip={false}
        chatVar={createVariable()}
        onClose={onClose}
        onSave={onSave}
      />,
    )

    await user.clear(screen.getByDisplayValue('conversation_var'))
    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder'), 'updated_var')
    await user.type(screen.getByPlaceholderText('workflow.chatVariable.modal.valuePlaceholder'), 'hello')
    await user.click(screen.getByText('common.operation.save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'var-1',
      name: 'updated_var',
      value: 'hello',
      value_type: ChatVarType.String,
    }))
    expect(onClose).toHaveBeenCalled()
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('closes when the portal dismisses', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    const TriggerHarness = () => {
      const [open, setOpen] = React.useState(true)

      return (
        <VariableModalTrigger
          open={open}
          setOpen={setOpen}
          showTip={false}
          chatVar={createVariable()}
          onClose={onClose}
          onSave={vi.fn()}
        />
      )
    }

    renderWorkflowComponent(<TriggerHarness />)

    expect(screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('workflow.chatVariable.modal.namePlaceholder')).not.toBeInTheDocument()
    })
    expect(onClose).toHaveBeenCalled()
  })
})
