import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  renderWorkflowComponent,
  renderWorkflowFlowComponent,
} from '@/app/components/workflow-app/__tests__/workflow-test-env'
import DifyBuilderPanelToggle from '@/features/dify-builder/editor/panel-toggle'

describe('DifyBuilderPanelToggle', () => {
  it('should hide the label while open and restore it when clicked again', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<DifyBuilderPanelToggle />)
    const button = screen.getByRole('button', {
      name: 'difyBuilder.buttonTooltip',
    })

    expect(button).toHaveTextContent('difyBuilder.buttonTooltip')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)

    expect(store.getState().showDifyBuilderPanel).toBe(true)
    expect(button).toHaveAccessibleName('difyBuilder.buttonTooltip')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).not.toHaveTextContent('difyBuilder.buttonTooltip')

    await user.click(button)

    expect(store.getState().showDifyBuilderPanel).toBe(false)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('difyBuilder.buttonTooltip')
  })

  it('should preserve native keyboard activation and focus with canvas shortcuts enabled', async () => {
    const user = userEvent.setup()
    renderWorkflowFlowComponent(<DifyBuilderPanelToggle />)
    const button = screen.getByRole('button', {
      name: 'difyBuilder.buttonTooltip',
    })

    await user.click(button)

    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard(' ')

    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('difyBuilder.buttonTooltip')

    await user.keyboard('{Enter}')

    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('should remain closed when the button is disabled', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<DifyBuilderPanelToggle />, {
      hooksStoreProps: {
        accessControl: {
          canEdit: false,
          canRun: true,
          canImportExportDSL: true,
          canReleaseAndVersion: true,
        },
      },
    })
    const button = screen.getByRole('button', {
      name: 'difyBuilder.buttonTooltip',
    })

    expect(button).toBeDisabled()

    await user.click(button)

    expect(store.getState().showDifyBuilderPanel).toBe(false)
  })
})
