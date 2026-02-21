import type { ComponentProps } from 'react'
import type { useLocalFileUploader } from './hooks'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ALLOW_FILE_EXTENSIONS } from '@/types/app'
import Uploader from './uploader'

type LocalUploaderArgs = Parameters<typeof useLocalFileUploader>[0]

const mocks = vi.hoisted(() => ({
  hookArgs: undefined as LocalUploaderArgs | undefined,
  handleLocalFileUpload: vi.fn<(file: File) => void>(),
}))

vi.mock('./hooks', () => ({
  useLocalFileUploader: (args: LocalUploaderArgs) => {
    mocks.hookArgs = args
    return {
      handleLocalFileUpload: mocks.handleLocalFileUpload,
    }
  },
}))

const getInput = () => {
  const input = screen.getByTestId('local-file-input')
  return input as HTMLInputElement
}

const renderUploader = (props: Partial<ComponentProps<typeof Uploader>> = {}) => {
  const onUpload = vi.fn()
  const closePopover = vi.fn()
  const childRenderer = vi.fn((hovering: boolean) => (
    <div data-testid="hover-state">{hovering ? 'hovering' : 'idle'}</div>
  ))

  const result = render(
    <Uploader
      onUpload={onUpload}
      closePopover={closePopover}
      limit={3}
      disabled={false}
      {...props}
    >
      {childRenderer}
    </Uploader>,
  )

  return {
    ...result,
    onUpload,
    closePopover,
    childRenderer,
  }
}

describe('Uploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hookArgs = undefined
  })

  describe('Rendering', () => {
    it('should render file input and idle child content', () => {
      renderUploader()
      const input = getInput()

      expect(screen.getByTestId('hover-state')).toHaveTextContent('idle')
      expect(input).toBeInTheDocument()
    })

    it('should set accept attribute from allowed file extensions', () => {
      renderUploader()
      const input = getInput()
      const expectedAccept = ALLOW_FILE_EXTENSIONS.map(ext => `.${ext}`).join(',')

      expect(input).toHaveAttribute('accept', expectedAccept)
    })

    it('should pass hook arguments to useLocalFileUploader', () => {
      const { onUpload } = renderUploader({ limit: 5, disabled: true })

      expect(mocks.hookArgs).toMatchObject({
        limit: 5,
        disabled: true,
      })
      expect(mocks.hookArgs?.onUpload).toBe(onUpload)
    })
  })

  describe('User Interactions', () => {
    it('should update hovering state on mouse enter and leave', async () => {
      const user = userEvent.setup()
      renderUploader()
      const input = getInput()

      expect(screen.getByTestId('hover-state')).toHaveTextContent('idle')

      await user.hover(input)
      expect(screen.getByTestId('hover-state')).toHaveTextContent('hovering')

      await user.unhover(input)
      expect(screen.getByTestId('hover-state')).toHaveTextContent('idle')
    })

    it('should call handleLocalFileUpload and closePopover when file is selected', async () => {
      const user = userEvent.setup()
      const { closePopover } = renderUploader()
      const input = getInput()
      const file = new File(['hello'], 'demo.png', { type: 'image/png' })

      await user.upload(input, file)

      expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(file)
      expect(closePopover).toHaveBeenCalledTimes(1)
    })

    it('should reset input value on click', async () => {
      const user = userEvent.setup()
      renderUploader()
      const input = getInput()
      const file = new File(['hello'], 'demo.png', { type: 'image/png' })

      await user.upload(input, file)
      expect(input.files).toHaveLength(1)

      await user.click(input)

      expect(input.value).toBe('')
    })

    it('should not upload or close popover when no file is selected', () => {
      const { closePopover } = renderUploader()
      const input = getInput()

      Object.defineProperty(input, 'files', {
        value: [] as unknown as FileList,
        configurable: true,
      })
      input.dispatchEvent(new Event('change', { bubbles: true }))

      expect(mocks.handleLocalFileUpload).not.toHaveBeenCalled()
      expect(closePopover).not.toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should disable file input when disabled prop is true', () => {
      renderUploader({ disabled: true })
      const input = getInput()

      expect(input).toBeDisabled()
    })
  })
})
