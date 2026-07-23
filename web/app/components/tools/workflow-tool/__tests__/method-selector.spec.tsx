import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MethodSelector from '../method-selector'

describe('MethodSelector', () => {
  it.each([
    ['llm', 'tools.createTool.toolInput.methodParameter'],
    ['form', 'tools.createTool.toolInput.methodSetting'],
  ])('shows the current %s method', (value, label) => {
    render(<MethodSelector value={value} onChange={vi.fn()} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it.each([
    ['llm', 'form', 'tools.createTool.toolInput.methodSettingTip'],
    ['form', 'llm', 'tools.createTool.toolInput.methodParameterTip'],
  ])('selects %s from the open menu', async (value, nextValue, optionTip) => {
    const onChange = vi.fn()
    render(<MethodSelector value={value} onChange={onChange} />)

    await userEvent.click(
      screen.getByText(
        value === 'llm'
          ? 'tools.createTool.toolInput.methodParameter'
          : 'tools.createTool.toolInput.methodSetting',
      ),
    )
    await userEvent.click(await screen.findByText(optionTip))

    expect(onChange).toHaveBeenCalledWith(nextValue)
    await waitFor(() => expect(screen.queryByText(optionTip)).not.toBeInTheDocument())
  })
})
