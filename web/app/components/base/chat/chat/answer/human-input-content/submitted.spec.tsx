import type { HumanInputFilledFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubmittedHumanInputContent } from './submitted'

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="mock-markdown">{content}</div>,
}))

describe('SubmittedHumanInputContent Integration', () => {
  const mockFormData: HumanInputFilledFormData = {
    rendered_content: 'Rendered **Markdown** content',
    action_id: 'btn_1',
    action_text: 'Submit Action',
    node_id: 'node_1',
    node_title: 'Node Title',
  }

  it('should render both content and executed action', () => {
    render(<SubmittedHumanInputContent formData={mockFormData} />)

    // Verify SubmittedContent rendering
    expect(screen.getByTestId('submitted-content')).toBeInTheDocument()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('Rendered **Markdown** content')

    // Verify ExecutedAction rendering
    expect(screen.getByTestId('executed-action')).toBeInTheDocument()
    // Trans component for triggered action. The mock usually renders the key.
    expect(screen.getByText('nodes.humanInput.userActions.triggered')).toBeInTheDocument()
  })
})
