import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import MessageTemplateBody from '../components/message-template-body'

const BodyEditor = ({ readOnly = false }: { readOnly?: boolean }) => {
  const [value, setValue] = useState('Please review this request. ')
  return (
    <>
      <MessageTemplateBody
        nodeId="approval"
        value={value}
        onChange={setValue}
        readOnly={readOnly}
      />
      <output aria-label="Message body value">{value}</output>
    </>
  )
}

describe('Human Input V2 message body editor', () => {
  it('inserts one request URL at the end without replacing the existing body before the editor is focused', async () => {
    const user = userEvent.setup()
    render(<BodyEditor />)

    await user.dblClick(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.insertRequestURL' }),
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Message body value')).toHaveTextContent(
        'Please review this request. {{#url#}}',
      ),
    )
    expect(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.template.requestURLInserted',
      }),
    ).toBeDisabled()
    expect(screen.getByText('common.promptEditor.requestURL.item.title')).toBeInTheDocument()
  })

  it('updates insertion availability when an existing URL is removed from the body', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MessageTemplateBody nodeId="approval" value="Review {{#url#}}" onChange={onChange} />,
    )
    expect(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputV2.template.requestURLInserted',
      }),
    ).toBeDisabled()

    rerender(<MessageTemplateBody nodeId="approval" value="Review" onChange={onChange} />)
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.insertRequestURL' }),
    ).toBeEnabled()
    expect(screen.queryByText('common.promptEditor.requestURL.item.title')).not.toBeInTheDocument()
  })

  it('keeps a read-only body unchanged and prevents insertion', () => {
    render(<BodyEditor readOnly />)
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.insertRequestURL' }),
    ).toBeDisabled()
    expect(screen.getByLabelText('Message body value')).toHaveTextContent(
      'Please review this request.',
    )
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.humanInputV2.template.body' }),
    ).toHaveAttribute('contenteditable', 'false')
  })
})
