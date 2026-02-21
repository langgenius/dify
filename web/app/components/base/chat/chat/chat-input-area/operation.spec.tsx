import type { EnableType } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '../../embedded-chatbot/theme/theme-context'
import Operation from './operation'

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInChatInput: ({ readonly }: { readonly?: boolean }) => (
    <div data-testid="file-uploader" data-readonly={readonly} />
  ),
}))

const createMockTheme = (overrides?: Partial<Theme>): Theme => {
  const theme = new Theme()
  theme.primaryColor = 'rgb(255, 0, 0)'
  return Object.assign(theme, overrides || {})
}

describe('Operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render send button always', () => {
      render(<Operation onSend={vi.fn()} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render file uploader when fileConfig.enabled is true', () => {
      const fileConfig: FileUpload = { enabled: true } as FileUpload

      render(
        <Operation
          onSend={vi.fn()}
          fileConfig={fileConfig}
        />,
      )

      expect(screen.getByTestId('file-uploader')).toBeInTheDocument()
    })

    it('should not render file uploader when fileConfig is undefined', () => {
      render(<Operation onSend={vi.fn()} />)

      expect(screen.queryByTestId('file-uploader')).not.toBeInTheDocument()
    })

    it('should render voice input button when speechToTextConfig.enabled is true', () => {
      const speechConfig: EnableType = { enabled: true }

      render(
        <Operation
          onSend={vi.fn()}
          speechToTextConfig={speechConfig}
        />,
      )

      expect(screen.getAllByRole('button')).toHaveLength(2)
    })

    it('should not render voice input button when speechToTextConfig.enabled is false', () => {
      const speechConfig: EnableType = { enabled: false }

      render(
        <Operation
          onSend={vi.fn()}
          speechToTextConfig={speechConfig}
        />,
      )

      expect(screen.getAllByRole('button')).toHaveLength(1)
    })
  })

  describe('Send Button Behavior', () => {
    it('should call onSend when clicked and not readonly', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()

      render(<Operation onSend={onSend} />)

      await user.click(screen.getByRole('button'))

      expect(onSend).toHaveBeenCalledTimes(1)
    })

    it('should not call onSend when readonly is true', async () => {
      const user = userEvent.setup()
      const onSend = vi.fn()

      render(<Operation onSend={onSend} readonly />)

      await user.click(screen.getByRole('button'))

      expect(onSend).not.toHaveBeenCalled()
    })

    it('should apply theme primaryColor as background style when theme is provided', () => {
      render(
        <Operation
          onSend={vi.fn()}
          theme={createMockTheme()}
        />,
      )

      expect(screen.getByRole('button')).toHaveStyle({
        backgroundColor: 'rgb(255, 0, 0)',
      })
    })

    it('should not apply background style when theme is null', () => {
      render(
        <Operation
          onSend={vi.fn()}
          theme={null}
        />,
      )

      expect(screen.getByRole('button').style.backgroundColor).toBe('')
    })
  })

  describe('Voice Input Button', () => {
    it('should call onShowVoiceInput when clicked', async () => {
      const user = userEvent.setup()
      const onShowVoiceInput = vi.fn()

      render(
        <Operation
          onSend={vi.fn()}
          speechToTextConfig={{ enabled: true }}
          onShowVoiceInput={onShowVoiceInput}
        />,
      )

      const buttons = screen.getAllByRole('button')
      const voiceButton = buttons[0]

      await user.click(voiceButton)

      expect(onShowVoiceInput).toHaveBeenCalledTimes(1)
    })

    it('should disable voice button when readonly is true', async () => {
      const user = userEvent.setup()
      const onShowVoiceInput = vi.fn()

      render(
        <Operation
          onSend={vi.fn()}
          speechToTextConfig={{ enabled: true }}
          onShowVoiceInput={onShowVoiceInput}
          readonly
        />,
      )

      const buttons = screen.getAllByRole('button')
      const voiceButton = buttons[0]

      expect(voiceButton).toBeDisabled()

      await user.click(voiceButton)

      expect(onShowVoiceInput).not.toHaveBeenCalled()
    })
  })
})
