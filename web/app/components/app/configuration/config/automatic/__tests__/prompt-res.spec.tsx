import { render, screen } from '@testing-library/react'
import PromptRes from '../prompt-res'

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: ({ value, workflowVariableBlock }: { value: string, workflowVariableBlock: { show: boolean } }) => (
    <div data-testid="prompt-editor" data-show={String(workflowVariableBlock.show)}>
      {value}
    </div>
  ),
}))

describe('PromptRes', () => {
  it('should render the prompt value and remount when the value changes', () => {
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)

    const { rerender } = render(
      <PromptRes
        value="alpha"
        workflowVariableBlock={{ show: false }}
      />,
    )

    expect(screen.getByTestId('prompt-editor')).toHaveTextContent('alpha')
    expect(screen.getByTestId('prompt-editor')).toHaveAttribute('data-show', 'false')

    rerender(
      <PromptRes
        value="beta"
        workflowVariableBlock={{ show: true }}
      />,
    )

    expect(screen.getByTestId('prompt-editor')).toHaveTextContent('beta')
    expect(screen.getByTestId('prompt-editor')).toHaveAttribute('data-show', 'true')

    nowSpy.mockRestore()
  })
})
