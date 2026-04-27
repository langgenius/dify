import type { HumanInputFilledFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { SubmittedHumanInputContent } from '../submitted'

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

  it('should prefer structured form data over rendered markdown when available', () => {
    render(
      <SubmittedHumanInputContent formData={{
        ...mockFormData,
        form_content: 'Decision: {{#$output.answer#}}',
        inputs: [{
          type: InputVarType.paragraph,
          output_variable_name: 'answer',
          default: { type: 'constant', value: '', selector: [] },
        }],
        submitted_data: {
          answer: 'approved',
        },
      }}
      />,
    )

    expect(screen.getByTestId('submitted-form-content')).toBeInTheDocument()
    expect(screen.getByTestId('submitted-field-answer')).toHaveTextContent('approved')
    expect(screen.queryByTestId('submitted-content')).not.toBeInTheDocument()
  })

  it('should render submitted select and file fields with the original form layout', () => {
    render(
      <SubmittedHumanInputContent formData={{
        ...mockFormData,
        form_content: '{{#$output.decision#}} {{#$output.attachment#}}',
        inputs: [
          {
            type: InputVarType.select,
            output_variable_name: 'decision',
            option_source: { type: 'constant', value: ['approve', 'reject'], selector: [] },
          },
          {
            type: InputVarType.singleFile,
            output_variable_name: 'attachment',
            allowed_file_extensions: [],
            allowed_file_types: [],
            allowed_file_upload_methods: [],
          },
        ],
        submitted_data: {
          decision: 'approve',
          attachment: {
            related_id: 'file-1',
            upload_file_id: 'upload-1',
            filename: 'decision.pdf',
            extension: 'pdf',
            size: 128,
            mime_type: 'application/pdf',
            transfer_method: TransferMethod.local_file,
            type: 'document',
            url: 'https://example.com/decision.pdf',
            remote_url: '',
          },
        },
      }}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'decision' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'decision' })).toHaveTextContent('approve')
    expect(screen.getByTestId('submitted-field-attachment')).toHaveTextContent('decision.pdf')
  })

  it('should fallback to rendered markdown when structured form data is empty', () => {
    render(
      <SubmittedHumanInputContent formData={{
        ...mockFormData,
        submitted_data: {},
      }}
      />,
    )

    expect(screen.getByTestId('submitted-content')).toBeInTheDocument()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('Rendered **Markdown** content')
    expect(screen.queryByTestId('submitted-field-values')).not.toBeInTheDocument()
  })
})
