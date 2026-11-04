import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { useLocale } from '#i18n'
import ToolCallItem from '../tool-call'

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'en'),
}))

const mockToolCall = {
  status: 'success',
  error: null,
  tool_name: 'test_tool',
  tool_label: { en: 'Test Tool Label' },
  tool_icon: 'icon',
  time_cost: 1.5,
  tool_input: { query: 'hello' },
  tool_output: { result: 'world' },
}

describe('ToolCallItem', () => {
  it('should fallback to locale key with underscores when hyphenated key is missing', () => {
    vi.mocked(useLocale).mockReturnValueOnce('en-US')
    const fallbackLocaleToolCall = {
      ...mockToolCall,
      tool_label: { en_US: 'Fallback Label' },
    }

    render(<ToolCallItem toolCall={fallbackLocaleToolCall} isLLM={false} />)
    expect(screen.getByText('Fallback Label')).toBeInTheDocument()
  })

  it('should format time correctly', () => {
    render(<ToolCallItem toolCall={mockToolCall} isLLM={false} />)
    expect(screen.getByText('1.500 s')).toBeInTheDocument()

    // Test ms format
    render(<ToolCallItem toolCall={{ ...mockToolCall, time_cost: 0.5 }} isLLM={false} />)
    expect(screen.getByText('500.000 ms')).toBeInTheDocument()

    // Test minute format
    render(<ToolCallItem toolCall={{ ...mockToolCall, time_cost: 65 }} isLLM={false} />)
    expect(screen.getByText('1 m 5.000 s')).toBeInTheDocument()
  })

  it('reveals tool inputs and outputs and hides them when collapsed', async () => {
    const user = userEvent.setup()
    render(<ToolCallItem toolCall={mockToolCall} isLLM={false} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByText('Test Tool Label'))
    const editors = screen.getAllByRole('textbox')
    expect(screen.getByText('INPUT')).toBeInTheDocument()
    expect(JSON.parse((editors[0] as HTMLTextAreaElement).value)).toEqual({ query: 'hello' })
    expect(screen.getByText('OUTPUT')).toBeInTheDocument()
    expect(JSON.parse((editors[1] as HTMLTextAreaElement).value)).toEqual({ result: 'world' })
    for (const editor of editors) expect(editor).toHaveAttribute('readonly')
    await user.click(screen.getByText('Test Tool Label'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('should display error message when status is error', async () => {
    const user = userEvent.setup()
    const errorToolCall = {
      ...mockToolCall,
      status: 'error',
      error: 'Something went wrong',
    }
    render(<ToolCallItem toolCall={errorToolCall} isLLM={false} />)

    await user.click(screen.getByText('Test Tool Label'))
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it.each([
    [800, '800'],
    [1200, '1.2K'],
    [1200000, '1.2M'],
  ])('formats %s LLM tokens as %s', (tokens, formatted) => {
    render(<ToolCallItem toolCall={mockToolCall} isLLM tokens={Number(tokens)} />)
    expect(screen.getByText(`${formatted} tokens`)).toBeInTheDocument()
  })

  it.each([true, false])(
    'reveals observation and the correct LLM result for isFinal=%s',
    async (isFinal) => {
      const user = userEvent.setup()
      render(
        <ToolCallItem
          toolCall={mockToolCall}
          isLLM
          observation="Tool returned a result"
          finalAnswer="Use the result"
          isFinal={isFinal}
        />,
      )
      await user.click(screen.getByText('LLM'))
      expect(screen.getByText('OBSERVATION')).toBeInTheDocument()
      expect(screen.getAllByRole('textbox')[2]).toHaveValue(
        JSON.stringify('Tool returned a result'),
      )
      expect(screen.getByText(isFinal ? 'FINAL ANSWER' : 'THOUGHT')).toBeInTheDocument()
      expect(screen.queryByText(isFinal ? 'THOUGHT' : 'FINAL ANSWER')).not.toBeInTheDocument()
      expect(screen.getAllByRole('textbox')[3]).toHaveValue(JSON.stringify('Use the result'))
    },
  )
})
