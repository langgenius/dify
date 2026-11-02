import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store/store'
import ChatVariableTrigger from '../chat-variable-trigger'

describe('ChatVariableTrigger', () => {
  it('omits conversation variables from a workflow editor', () => {
    renderWorkflowComponent(<ChatVariableTrigger />, {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    expect(
      screen.queryByRole('button', { name: 'workflow.chatVariable.panelTitle' }),
    ).not.toBeInTheDocument()
  })

  it.each([true, false])(
    'opens the chat variable panel only when editing is allowed (canEdit=%s)',
    async (canEdit) => {
      const user = userEvent.setup()
      const { store } = renderWorkflowComponent(<ChatVariableTrigger />, {
        resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
        hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canEdit } },
      })
      const button = screen.getByRole('button', { name: 'workflow.chatVariable.panelTitle' })
      if (canEdit) expect(button).toBeEnabled()
      else expect(button).toBeDisabled()
      await user.click(button)
      expect(store.getState().showChatVariablePanel).toBe(canEdit)
      expect(button).toHaveAttribute('aria-expanded', String(canEdit))
    },
  )
})
