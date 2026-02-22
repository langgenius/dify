import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import ToolCallItem from './tool-call'

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: React.ReactNode, value: string | object }) => (
    <div data-testid="code-editor">
      <div data-testid="code-editor-title">{title}</div>
      <div data-testid="code-editor-value">{JSON.stringify(value)}</div>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ type }: { type: BlockEnum }) => <div data-testid="block-icon" data-type={type} />,
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
  it('should render tool name correctly for LLM', () => {
    render(<ToolCallItem toolCall={mockToolCall} isLLM={true} />)
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.getByTestId('block-icon')).toHaveAttribute('data-type', BlockEnum.LLM)
  })

  it('should render tool name from label for non-LLM', () => {
    render(<ToolCallItem toolCall={mockToolCall} isLLM={false} />)
    expect(screen.getByText('Test Tool Label')).toBeInTheDocument()
    expect(screen.getByTestId('block-icon')).toHaveAttribute('data-type', BlockEnum.Tool)
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

  it('should format token count correctly', () => {
    render(<ToolCallItem toolCall={mockToolCall} isLLM={true} tokens={1200} />)
    expect(screen.getByText('1.2K tokens')).toBeInTheDocument()

    render(<ToolCallItem toolCall={mockToolCall} isLLM={true} tokens={800} />)
    expect(screen.getByText('800 tokens')).toBeInTheDocument()

    render(<ToolCallItem toolCall={mockToolCall} isLLM={true} tokens={1200000} />)
    expect(screen.getByText('1.2M tokens')).toBeInTheDocument()
  })

  it('should handle collapse/expand', () => {
    render(<ToolCallItem toolCall={mockToolCall} isLLM={false} />)

    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/Test Tool Label/i))
    expect(screen.getAllByTestId('code-editor')).toHaveLength(2)
  })

  it('should display error message when status is error', () => {
    const errorToolCall = {
      ...mockToolCall,
      status: 'error',
      error: 'Something went wrong',
    }
    render(<ToolCallItem toolCall={errorToolCall} isLLM={false} />)

    fireEvent.click(screen.getByText(/Test Tool Label/i))
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('should display LLM specific fields when expanded', () => {
    render(
      <ToolCallItem
        toolCall={mockToolCall}
        isLLM={true}
        observation="test observation"
        finalAnswer="test final answer"
        isFinal={true}
      />,
    )

    fireEvent.click(screen.getByText('LLM'))

    const titles = screen.getAllByTestId('code-editor-title')
    const titleTexts = titles.map(t => t.textContent)

    expect(titleTexts).toContain('INPUT')
    expect(titleTexts).toContain('OUTPUT')
    expect(titleTexts).toContain('OBSERVATION')
    expect(titleTexts).toContain('FINAL ANSWER')
  })

  it('should display THOUGHT instead of FINAL ANSWER when isFinal is false', () => {
    render(
      <ToolCallItem
        toolCall={mockToolCall}
        isLLM={true}
        observation="test observation"
        finalAnswer="test thought"
        isFinal={false}
      />,
    )

    fireEvent.click(screen.getByText('LLM'))
    expect(screen.getByText('THOUGHT')).toBeInTheDocument()
    expect(screen.queryByText('FINAL ANSWER')).not.toBeInTheDocument()
  })
})
