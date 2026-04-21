import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasoningModeType } from '../../types'
import ReasoningModePicker from '../reasoning-mode-picker'

describe('parameter-extractor/reasoning-mode-picker', () => {
  it('switches between prompt and function call reasoning modes', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    const { rerender } = render(
      <ReasoningModePicker
        type={ReasoningModeType.prompt}
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByText('workflow.nodes.parameterExtractor.reasoningModeFunctionToolCalling'))

    rerender(
      <ReasoningModePicker
        type={ReasoningModeType.functionCall}
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByText('workflow.nodes.parameterExtractor.reasoningModePrompt'))

    expect(handleChange).toHaveBeenNthCalledWith(1, ReasoningModeType.functionCall)
    expect(handleChange).toHaveBeenNthCalledWith(2, ReasoningModeType.prompt)
  })
})
