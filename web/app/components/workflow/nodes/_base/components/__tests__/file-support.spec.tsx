import type { UploadFileSetting } from '@/app/components/workflow/types'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { TransferMethod } from '@/types/app'
import FileTypeItem from '../file-type-item'
import FileUploadSetting from '../file-upload-setting'

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.files.upload.get.queryKey(), {
    ...createFileUploadConfigFixture(),
    image_file_size_limit: 10,
    file_size_limit: 20,
    audio_file_size_limit: 30,
    video_file_size_limit: 40,
    workflow_file_upload_limit: 10,
  })
  return renderWithConsoleQuery(ui, { queryClient })
}

const createPayload = (overrides: Partial<UploadFileSetting> = {}): UploadFileSetting => ({
  allowed_file_upload_methods: [TransferMethod.local_file],
  max_length: 2,
  allowed_file_types: [SupportUploadFileTypes.document],
  allowed_file_extensions: ['pdf'],
  ...overrides,
})

describe('File upload support components', () => {
  describe('FileTypeItem', () => {
    it('should render built-in file types and toggle the selected type on click', async () => {
      const user = userEvent.setup()
      const onToggle = vi.fn()

      render(
        <FileTypeItem type={SupportUploadFileTypes.image} selected={false} onToggle={onToggle} />,
      )

      expect(screen.getByText('appDebug.variableConfig.file.image.name')).toBeInTheDocument()
      expect(screen.getByText('JPG, JPEG, PNG, GIF, WEBP, SVG')).toBeInTheDocument()

      await user.click(
        screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.image.name' }),
      )
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

      const input = screen.getByPlaceholderText(
        'appDebug.variableConfig.file.custom.createPlaceholder',
      )
      await user.type(input, 'csv')
      await user.tab()

      expect(screen.getByText('json')).toBeInTheDocument()
      expect(onCustomFileTypesChange).toHaveBeenCalledWith(['json', 'csv'])
    })
  })

  describe('FileUploadSetting', () => {
    it.each([false, true])(
      'should associate file type errors with the checkboxes in feature panel mode %s',
      async (inFeaturePanel) => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        const payload = createPayload({ allowed_file_types: [] })
        const { rerender } = render(
          <FileUploadSetting
            payload={payload}
            isMultiple={false}
            inFeaturePanel={inFeaturePanel}
            validationError={{ field: 'allowed_file_types', message: 'Choose a file type' }}
            onChange={onChange}
          />,
        )

        for (const checkbox of screen.getAllByRole('checkbox')) {
          expect(checkbox).toBeInvalid()
          expect(checkbox).toHaveAccessibleDescription('Choose a file type')
        }
        await user.click(
          screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.document.name' }),
        )
        expect(onChange).toHaveBeenLastCalledWith({
          ...payload,
          allowed_file_types: [SupportUploadFileTypes.document],
        })

        rerender(
          <FileUploadSetting
            payload={createPayload()}
            isMultiple={false}
            inFeaturePanel={inFeaturePanel}
            onChange={onChange}
          />,
        )
        expect(screen.queryByText('Choose a file type')).not.toBeInTheDocument()
        for (const checkbox of screen.getAllByRole('checkbox')) {
          expect(checkbox).not.toBeInvalid()
          expect(checkbox).not.toHaveAccessibleDescription()
        }
      },
    )

    it.each([false, true])(
      'should associate extension errors only with the named tag input in feature panel mode %s',
      async (inFeaturePanel) => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        const payload = createPayload({
          allowed_file_types: [SupportUploadFileTypes.custom],
          allowed_file_extensions: [],
        })
        const { rerender } = render(
          <FileUploadSetting
            payload={payload}
            isMultiple={false}
            inFeaturePanel={inFeaturePanel}
            validationError={{ field: 'allowed_file_extensions', message: 'Add an extension' }}
            onChange={onChange}
          />,
        )

        const input = screen.getByRole('textbox', {
          name: 'appDebug.variableConfig.file.custom.name',
        })
        expect(input).toBeInvalid()
        expect(input).toHaveAccessibleDescription('Add an extension')
        expect(
          screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.custom.name' }),
        ).not.toBeInvalid()
        await user.type(input, '.csv{Enter}')
        expect(onChange).toHaveBeenLastCalledWith({
          ...payload,
          allowed_file_extensions: ['.csv'],
        })

        rerender(
          <FileUploadSetting
            payload={{ ...payload, allowed_file_extensions: ['.csv'] }}
            isMultiple={false}
            inFeaturePanel={inFeaturePanel}
            onChange={onChange}
          />,
        )
        expect(input).not.toBeInvalid()
        expect(input).not.toHaveAccessibleDescription()
        expect(screen.queryByText('Add an extension')).not.toBeInTheDocument()
      },
    )

    it('should let keyboard users change upload methods while preserving the rest of the settings', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const initialPayload = createPayload()
      const StatefulFileUploadSetting = () => {
        const [payload, setPayload] = useState(initialPayload)

        return (
          <>
            <FileUploadSetting
              payload={payload}
              isMultiple={false}
              inFeaturePanel
              hideSupportFileType
              onChange={(nextPayload) => {
                setPayload(nextPayload)
                onChange(nextPayload)
              }}
            />
            <button type="button">Done</button>
          </>
        )
      }

      render(<StatefulFileUploadSetting />)

      expect(
        screen.getByRole('radiogroup', { name: 'appDebug.variableConfig.uploadFileTypes' }),
      ).toBeInTheDocument()
      await user.tab()
      expect(
        screen.getByRole('radio', { name: 'appDebug.variableConfig.localUpload' }),
      ).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('radio', { name: 'URL' })).toBeChecked()
      expect(onChange).toHaveBeenLastCalledWith({
        ...initialPayload,
        allowed_file_upload_methods: [TransferMethod.remote_url],
      })

      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('radio', { name: 'appDebug.variableConfig.both' })).toBeChecked()
      expect(onChange).toHaveBeenLastCalledWith({
        ...initialPayload,
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })

      await user.keyboard('{ArrowRight}')
      expect(
        screen.getByRole('radio', { name: 'appDebug.variableConfig.localUpload' }),
      ).toBeChecked()
      expect(onChange).toHaveBeenLastCalledWith(initialPayload)
      await user.tab()
      expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus()
    })

    it('should keep empty and updated upload method selections controlled by the payload', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const payload = createPayload({ allowed_file_upload_methods: [] })
      const { rerender } = render(
        <FileUploadSetting payload={payload} isMultiple={false} onChange={onChange} />,
      )

      expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument()
      await user.click(screen.getByText('URL'))
      expect(onChange).toHaveBeenLastCalledWith({
        ...payload,
        allowed_file_upload_methods: [TransferMethod.remote_url],
      })

      rerender(
        <FileUploadSetting
          payload={{ ...payload, allowed_file_upload_methods: [TransferMethod.remote_url] }}
          isMultiple={false}
          onChange={onChange}
        />,
      )
      expect(screen.getByRole('radio', { name: 'URL' })).toBeChecked()

      rerender(<FileUploadSetting payload={payload} isMultiple={false} onChange={onChange} />)
      expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument()
    })

    it('should update file types, upload methods, and upload limits', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(<FileUploadSetting payload={createPayload()} isMultiple onChange={onChange} />)

      await user.click(screen.getByText('appDebug.variableConfig.file.image.name'))
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed_file_types: [SupportUploadFileTypes.document, SupportUploadFileTypes.image],
        }),
      )

      await user.click(screen.getByText('URL'))
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed_file_upload_methods: [TransferMethod.remote_url],
        }),
      )

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } })
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          max_length: 5,
        }),
      )
    })

    it('should keep upload limits within the configured range', async () => {
      const user = userEvent.setup()
      const StatefulFileUploadSetting = () => {
        const [payload, setPayload] = useState(createPayload)

        return <FileUploadSetting payload={payload} isMultiple onChange={setPayload} />
      }

      render(<StatefulFileUploadSetting />)

      const input = screen.getByRole('spinbutton')
      await user.click(input)

      fireEvent.change(input, { target: { value: '20' } })
      expect(input).toHaveValue(10)

      fireEvent.change(input, { target: { value: '0' } })
      expect(input).toHaveValue(1)

      fireEvent.change(input, { target: { value: '' } })
      expect(input).toHaveValue(null)
      await user.tab()
      expect(input).toHaveValue(1)
    })

    it('should toggle built-in and custom file type selections', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <FileUploadSetting payload={createPayload()} isMultiple={false} onChange={onChange} />,
      )

      await user.click(screen.getByText('appDebug.variableConfig.file.document.name'))
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowed_file_types: [],
        }),
      )

      rerender(
        <FileUploadSetting payload={createPayload()} isMultiple={false} onChange={onChange} />,
      )

      await user.click(screen.getByText('appDebug.variableConfig.file.custom.name'))
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowed_file_types: [SupportUploadFileTypes.custom],
        }),
      )

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
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowed_file_types: [],
        }),
      )
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

      expect(
        screen.queryByText('appDebug.variableConfig.file.document.name'),
      ).not.toBeInTheDocument()
    })
  })
})
