import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import MethodSelector from '../method-selector'

describe('MethodSelector', () => {
  it.each([
    ['llm', 'form', 'tools.createTool.toolInput.methodSettingTip'],
    ['form', 'llm', 'tools.createTool.toolInput.methodParameterTip'],
  ])('selects %s from the open menu', async (value, nextValue, optionTip) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<MethodSelector value={value} onChange={onChange} />)

    await user.click(
      screen.getByText(
        value === 'llm'
          ? 'tools.createTool.toolInput.methodParameter'
          : 'tools.createTool.toolInput.methodSetting',
      ),
    )
    await user.click(await screen.findByText(optionTip))

    expect(onChange).toHaveBeenCalledWith(nextValue)
    await waitFor(() => expect(screen.queryByText(optionTip)).not.toBeInTheDocument())
    rerender(<MethodSelector value={nextValue} onChange={onChange} />)
    expect(
      screen.getByText(
        nextValue === 'llm'
          ? 'tools.createTool.toolInput.methodParameter'
          : 'tools.createTool.toolInput.methodSetting',
      ),
    ).toBeInTheDocument()
  })
})
