import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Operation from '../operation'

const uploader = vi.hoisted(() =>
  vi.fn<(_props: { readonly?: boolean; fileConfig: FileUpload }) => null>(() => null),
)

// File upload interactions are covered by file-uploader-in-chat-input's own suite.
vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInChatInput: (props: { readonly?: boolean; fileConfig: FileUpload }) =>
    uploader(props),
}))

describe('Operation', () => {
  it('enables file upload only when configured and forwards readonly protection', () => {
    const fileConfig: FileUpload = { enabled: true, number_limits: 3 }
    const { rerender } = render(<Operation onSend={vi.fn()} />)
    expect(uploader).not.toHaveBeenCalled()

    rerender(<Operation onSend={vi.fn()} fileConfig={fileConfig} readonly />)
    expect(uploader).toHaveBeenLastCalledWith({ fileConfig, readonly: true })
    uploader.mockClear()
    rerender(<Operation onSend={vi.fn()} fileConfig={{ enabled: false }} />)
    expect(uploader).not.toHaveBeenCalled()
  })

  it('sends a message and blocks sending while readonly or disabled', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const { rerender } = render(<Operation onSend={onSend} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
    expect(onSend).toHaveBeenCalledTimes(1)

    for (const props of [{ readonly: true }, { disabled: true }]) {
      rerender(<Operation onSend={onSend} {...props} />)
      const send = screen.getByRole('button', { name: 'common.operation.send' })
      expect(send).toBeDisabled()
      await user.click(send)
      expect(onSend).toHaveBeenCalledTimes(1)
    }
  })

  it('starts voice input only when available and editable', async () => {
    const user = userEvent.setup()
    const onShowVoiceInput = vi.fn()
    const props = { onSend: vi.fn(), onShowVoiceInput, speechToTextConfig: { enabled: true } }
    const { rerender } = render(<Operation {...props} />)
    await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
    expect(onShowVoiceInput).toHaveBeenCalledTimes(1)

    rerender(<Operation {...props} readonly />)
    const voice = screen.getByRole('button', { name: 'common.voiceInput.start' })
    expect(voice).toBeDisabled()
    await user.click(voice)
    expect(onShowVoiceInput).toHaveBeenCalledTimes(1)

    rerender(<Operation {...props} speechToTextConfig={{ enabled: false }} />)
    expect(
      screen.queryByRole('button', { name: 'common.voiceInput.start' }),
    ).not.toBeInTheDocument()
    rerender(<Operation {...props} onShowVoiceInput={undefined} />)
    expect(
      screen.queryByRole('button', { name: 'common.voiceInput.start' }),
    ).not.toBeInTheDocument()
  })
})
