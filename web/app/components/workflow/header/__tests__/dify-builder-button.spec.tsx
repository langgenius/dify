import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  renderWorkflowComponent,
  renderWorkflowFlowComponent,
} from '../../__tests__/workflow-test-env'
import DifyBuilderButton from '../dify-builder-button'

describe('DifyBuilderButton', () => {
  it('should hide the label while open and restore it when clicked again', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<DifyBuilderButton disabled={false} />)
    const button = screen.getByRole('button', {
      name: 'workflow.difyBuilder.buttonTooltip',
    })

    expect(button).toHaveTextContent('workflow.difyBuilder.buttonTooltip')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)

    expect(store.getState().showDifyBuilderPanel).toBe(true)
    expect(button).toHaveAccessibleName('workflow.difyBuilder.buttonTooltip')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).not.toHaveTextContent('workflow.difyBuilder.buttonTooltip')

    await user.click(button)

    expect(store.getState().showDifyBuilderPanel).toBe(false)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('workflow.difyBuilder.buttonTooltip')
  })

  it('should preserve native keyboard activation and focus with canvas shortcuts enabled', async () => {
    const user = userEvent.setup()
    renderWorkflowFlowComponent(<DifyBuilderButton disabled={false} />)
    const button = screen.getByRole('button', {
      name: 'workflow.difyBuilder.buttonTooltip',
    })

    await user.click(button)

    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard(' ')

    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('workflow.difyBuilder.buttonTooltip')

    await user.keyboard('{Enter}')

    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('should remain closed when the button is disabled', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<DifyBuilderButton disabled />)
    const button = screen.getByRole('button', {
      name: 'workflow.difyBuilder.buttonTooltip',
    })

    expect(button).toBeDisabled()

    await user.click(button)

    expect(store.getState().showDifyBuilderPanel).toBe(false)
  })
})
