import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockOnSend } = vi.hoisted(() => ({
  mockOnSend: vi.fn(),
}))

vi.mock('@/app/components/base/chat/chat/context', () => ({
  useChatContext: () => ({ onSend: mockOnSend }),
}))

describe('StreamdownWrapper Markdown form submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    document.body.setAttribute(
      'data-markdown-form-field-name-extra-chars',
      '。.;；+=—()!*&（）！＊＆－',
    )
  })

  afterEach(() => {
    document.body.removeAttribute('data-markdown-form-field-name-extra-chars')
  })

  it('should preserve and submit field names containing configured punctuation', async () => {
    const user = userEvent.setup()
    const { default: StreamdownWrapper } = await import('../streamdown-wrapper')
    const partialContent = `<form data-format="json">
  <input type="text" name="field()!*`
    const content = `
<form data-format="json">
  <input type="text" name="营业&售后（SD）" value="mixed" placeholder="mixed-width" />
  <input type="text" name="字段（）！＊＆－" value="full" placeholder="full-width" />
  <input type="text" name="field()!*&-" value="half" placeholder="half-width" />
  <button>Submit</button>
</form>
`

    const { rerender } = render(<StreamdownWrapper latexContent={partialContent} />)
    rerender(<StreamdownWrapper latexContent={content} />)

    expect(await screen.findByPlaceholderText('mixed-width')).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('full-width')).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('half-width')).toHaveAttribute('name', 'field()!*&-')

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(mockOnSend).toHaveBeenCalledWith(
        '{"营业&售后（SD）":"mixed","字段（）！＊＆－":"full","field()!*&-":"half"}',
      )
    })
  })

  it('should preserve asterisks in static user message content', async () => {
    const { default: StreamdownWrapper } = await import('../streamdown-wrapper')
    const content = '{"field()!*&-":"half-width"}'

    render(<StreamdownWrapper latexContent={content} mode="static" />)

    expect(await screen.findByText(content)).toBeInTheDocument()
    expect(document.querySelector('em')).not.toBeInTheDocument()
  })

  it('should not render Markdown punctuation after a multiline form', async () => {
    const { default: StreamdownWrapper } = await import('../streamdown-wrapper')
    const content = `<form data-format="json">
  <input
    type="checkbox"
    name="财务。.;；+=—"
    data-tip="财务"
  />
  <input
    type="checkbox"
    name="营业&售后（SD）"
    data-tip="营业&售后"
  />
  <input type="text" name="备注" />
  <input type="text" name="normal-name" placeholder="正常字段" />
  <input type="text" name="字段（）！＊＆－" value="full-width" />
  <input type="text" name="field()!*&-" value="half-width" />
  <button type="submit" data-variant="primary">提交</button>
</form>`

    render(<StreamdownWrapper latexContent={content} />)

    expect(await screen.findByRole('button', { name: '提交' })).toBeInTheDocument()
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  it('should keep incomplete Markdown repair enabled when no form is present', async () => {
    const { default: StreamdownWrapper } = await import('../streamdown-wrapper')

    render(<StreamdownWrapper latexContent="This is *italic" />)

    const italic = await screen.findByText('italic')
    expect(italic.tagName).toBe('EM')
  })
})
