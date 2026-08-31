import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import DifyBuilderButton from '../dify-builder-button'

describe('DifyBuilderButton', () => {
  it('should expose a visible label and toggle the builder panel', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<DifyBuilderButton disabled={false} />)
    const button = screen.getByRole('button', {
      name: 'workflow.difyBuilder.buttonTooltip',
    })

    expect(button).toHaveTextContent('workflow.difyBuilder.buttonTooltip')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await user.click(button)

    expect(store.getState().showDifyBuilderPanel).toBe(true)
    expect(button).toHaveAttribute('aria-pressed', 'true')
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
