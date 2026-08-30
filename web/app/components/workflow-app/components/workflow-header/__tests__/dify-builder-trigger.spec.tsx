import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import DifyBuilderTrigger from '../dify-builder-trigger'

describe('DifyBuilderTrigger', () => {
  it('opens App Builder and hides the header entry while the panel is visible', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<DifyBuilderTrigger />)
    const trigger = screen.getByRole('button', { name: /difyBuilder\.buttonTooltip/ })
    expect(trigger).toHaveTextContent('workflow.difyBuilder.buttonTooltip')

    await user.click(trigger)

    expect(store.getState().showDifyBuilderPanel).toBe(true)
    expect(
      screen.queryByRole('button', { name: /difyBuilder\.buttonTooltip/ }),
    ).not.toBeInTheDocument()
  })
})
