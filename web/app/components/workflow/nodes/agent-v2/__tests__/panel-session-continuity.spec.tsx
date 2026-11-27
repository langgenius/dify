import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createData, createPanelEnvironment } from './panel-test-env'

vi.mock('@/app/components/app/tracing/inherited-tracing-summary', () => ({
  InheritedTracingSummary: () => null,
}))

const chatflow: EditorResource = {
  kind: 'app',
  collaborationEnabled: false,
  appId: 'chatflow-1',
  mode: 'advanced-chat',
}
const sessionSwitch = () =>
  screen.getByRole('switch', { name: 'workflowAgent.nodes.agent.sessionContinuity.title' })

describe('Continue agent session', () => {
  it('appears only in Chatflow', () => {
    const { unmount } = createPanelEnvironment().render()
    expect(screen.queryByRole('switch', { name: /sessionContinuity/ })).not.toBeInTheDocument()
    unmount()
    createPanelEnvironment({ resource: chatflow }).render()
    expect(sessionSwitch()).toBeInTheDocument()
  })

  it('treats nodes without the setting as continuing and describes both states', () => {
    createPanelEnvironment({ resource: chatflow }).render()
    expect(sessionSwitch()).toBeChecked()
    expect(sessionSwitch()).toHaveAccessibleDescription(
      'workflowAgent.nodes.agent.sessionContinuity.description',
    )
  })

  it('saves both states into the node from the keyboard', async () => {
    const user = userEvent.setup()
    const env = createPanelEnvironment({ resource: chatflow })
    env.render()
    sessionSwitch().focus()
    await user.keyboard(' ')
    await waitFor(() => expect(env.getNodeData().continue_agent_session).toBe(false))
    expect(sessionSwitch()).not.toBeChecked()
    await user.keyboard(' ')
    await waitFor(() => expect(env.getNodeData().continue_agent_session).toBe(true))
  })

  it('shows a saved off state', () => {
    createPanelEnvironment({
      resource: chatflow,
      data: createData({ continue_agent_session: false }),
    }).render()
    expect(sessionSwitch()).not.toBeChecked()
  })
  it('cannot change the setting in a read-only canvas', () => {
    createPanelEnvironment({ resource: chatflow, readonly: true }).render()
    expect(sessionSwitch()).toHaveAttribute('aria-disabled', 'true')
  })
})
