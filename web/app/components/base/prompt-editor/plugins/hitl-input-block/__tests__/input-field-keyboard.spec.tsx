import { detectPlatform } from '@tanstack/react-hotkeys'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import InputField from '../input-field'

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({ data: undefined }),
}))

it('lets the extension input commit its tag before the field shortcut saves', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  const shortcut = `{${modifier}>}{Enter}{/${modifier}}`

  function Host() {
    const [open, setOpen] = useState(true)
    return (
      open && (
        <InputField
          nodeId="file-input"
          isEdit={false}
          payload={{
            type: InputVarType.singleFile,
            output_variable_name: 'upload',
            allowed_file_types: [SupportUploadFileTypes.custom],
            allowed_file_extensions: ['.pdf'],
            allowed_file_upload_methods: [TransferMethod.local_file],
          }}
          onChange={(value) => {
            onSave(value)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      )
    )
  }

  render(<Host />)
  const extensionInput = screen.getByRole('textbox', {
    name: 'appDebug.variableConfig.file.custom.name',
  })
  await user.type(extensionInput, '.md')
  await user.keyboard(shortcut)

  expect(onSave).not.toHaveBeenCalled()
  expect(screen.getByText('.md')).toBeInTheDocument()
  expect(extensionInput).toHaveValue('')

  await user.click(screen.getByRole('textbox', { name: /saveResponseAs/ }))
  await user.keyboard(shortcut)

  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ allowed_file_extensions: ['.pdf', '.md'] }),
  )
  expect(extensionInput).not.toBeInTheDocument()
})
