import type { UploadFileSetting } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { useFileUploadConfig } from '@/service/use-common'
import { TransferMethod } from '@/types/app'
import FileTypeItem from '../file-type-item'
import FileUploadSetting from '../file-upload-setting'

const mockUseFileUploadConfig = vi.mocked(useFileUploadConfig)
const mockUseFileSizeLimit = vi.mocked(useFileSizeLimit)

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: vi.fn(),
}))

vi.mock('@/app/components/base/file-uploader/hooks', () => ({
  useFileSizeLimit: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const createPayload = (overrides: Partial<UploadFileSetting> = {}): UploadFileSetting => ({
  allowed_file_upload_methods: [TransferMethod.local_file],
  max_length: 2,
  allowed_file_types: [SupportUploadFileTypes.document],
  allowed_file_extensions: ['pdf'],
  ...overrides,
})

describe('File upload support components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFileUploadConfig.mockReturnValue({ data: {} } as ReturnType<typeof useFileUploadConfig>)
    mockUseFileSizeLimit.mockReturnValue({
      imgSizeLimit: 10 * 1024 * 1024,
      docSizeLimit: 20 * 1024 * 1024,
      audioSizeLimit: 30 * 1024 * 1024,
      videoSizeLimit: 40 * 1024 * 1024,
      maxFileUploadLimit: 10,
    } as ReturnType<typeof useFileSizeLimit>)
  })

  describe('FileTypeItem', () => {
    it('should render built-in file types and toggle the selected type on click', () => {
      const onToggle = vi.fn()

      render(
        <FileTypeItem
          type={SupportUploadFileTypes.image}
          selected={false}
          onToggle={onToggle}
        />,
      )

      expect(screen.getByText('appDebug.variableConfig.file.image.name')).toBeInTheDocument()
      expect(screen.getByText('JPG, JPEG, PNG, GIF, WEBP, SVG')).toBeInTheDocument()

      fireEvent.click(screen.getByText('appDebug.variableConfig.file.image.name'))
      expect(onToggle).toHaveBeenCalledWith(SupportUploadFileTypes.image)
    })

    it('should render the custom tag editor and emit custom extensions', async () => {
      const user = userEvent.setup()
      const onCustomFileTypesChange = vi.fn()

      render(
        <FileTypeItem
          type={SupportUploadFileTypes.custom}
          selected
          onToggle={vi.fn()}
          customFileTypes={['json']}
          onCustomFileTypesChange={onCustomFileTypesChange}
        />,
      )

      const input = screen.getByPlaceholderText('appDebug.variableConfig.file.custom.createPlaceholder')
      await user.type(input, 'csv')
      fireEvent.blur(input)

      expect(screen.getByText('json')).toBeInTheDocument()
      expect(onCustomFileTypesChange).toHaveBeenCalledWith(['json', 'csv'])
    })
  })

  describe('FileUploadSetting', () => {
    it('should update file types, upload methods, and upload limits', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <FileUploadSetting
          payload={createPayload()}
          isMultiple
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('appDebug.variableConfig.file.image.name'))
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        allowed_file_types: [SupportUploadFileTypes.document, SupportUploadFileTypes.image],
      }))

      await user.click(screen.getByText('URL'))
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        allowed_file_upload_methods: [TransferMethod.remote_url],
      }))

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } })
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        max_length: 5,
      }))
    })

    it('should toggle built-in and custom file type selections', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <FileUploadSetting
          payload={createPayload()}
          isMultiple={false}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('appDebug.variableConfig.file.document.name'))
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        allowed_file_types: [],
      }))

      rerender(
        <FileUploadSetting
          payload={createPayload()}
          isMultiple={false}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('appDebug.variableConfig.file.custom.name'))
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        allowed_file_types: [SupportUploadFileTypes.custom],
      }))

      rerender(
        <FileUploadSetting
          payload={createPayload({
            allowed_file_types: [SupportUploadFileTypes.custom],
          })}
          isMultiple={false}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('appDebug.variableConfig.file.custom.name'))
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        allowed_file_types: [],
      }))
    })

    it('should support both upload methods and update custom extensions', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <FileUploadSetting
          payload={createPayload()}
          isMultiple={false}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('appDebug.variableConfig.both'))
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      }))

      rerender(
        <FileUploadSetting
          payload={createPayload({
            allowed_file_types: [SupportUploadFileTypes.custom],
          })}
          isMultiple={false}
          onChange={onChange}
        />,
      )

      const input = screen.getByPlaceholderText('appDebug.variableConfig.file.custom.createPlaceholder')
      await user.type(input, 'csv')
      fireEvent.blur(input)

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        allowed_file_extensions: ['pdf', 'csv'],
      }))
    })

    it('should render support file types in the feature panel and hide them when requested', () => {
      const { rerender } = render(
        <FileUploadSetting
          payload={createPayload()}
          isMultiple={false}
          inFeaturePanel
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByText('appDebug.variableConfig.file.supportFileTypes')).toBeInTheDocument()

      rerender(
        <FileUploadSetting
          payload={createPayload()}
          isMultiple={false}
          inFeaturePanel
          hideSupportFileType
          onChange={vi.fn()}
        />,
      )

      expect(screen.queryByText('appDebug.variableConfig.file.document.name')).not.toBeInTheDocument()
    })
  })
})
