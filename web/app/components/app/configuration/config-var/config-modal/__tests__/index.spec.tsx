import type { InputVar } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { toast } from '@/app/components/app/configuration/toast'
import { useStore } from '@/app/components/app/store'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AppModeEnum, TransferMethod } from '@/types/app'
import ConfigModal from '../index'

vi.mock('next/navigation', async () => ({
  ...(await vi.importActual<typeof import('next/navigation')>('next/navigation')),
  useParams: () => ({}),
}))

vi.mock('@/service/use-common', async () => ({
  ...(await vi.importActual<typeof import('@/service/use-common')>('@/service/use-common')),
  useFileUploadConfig: () => ({ data: undefined }),
}))

const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

const createPayload = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: '',
  variable: 'question',
  required: false,
  hide: false,
  options: [],
  default: 'hello',
  max_length: 32,
  ...overrides,
})

describe('ConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      appDetail: {
        mode: AppModeEnum.CHAT,
      } as App & Partial<AppSSO>,
    })
  })

  it('should copy the variable name into the label when the label is empty', () => {
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const textboxes = screen.getAllByRole('textbox')
    fireEvent.blur(textboxes[0]!, { target: { value: 'question' } })

    expect(textboxes[1])!.toHaveValue('question')
  })

  it('should submit the edited payload when the form is valid', () => {
    const onConfirm = vi.fn()
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload({ label: 'Question' })}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'updated default' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        default: 'updated default',
        label: 'Question',
        variable: 'question',
      }),
      undefined,
    )
  })

  it('should label editable fields and submit once when Enter is pressed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload({ label: 'Question' })}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })).toHaveValue(
      'question',
    )
    expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })).toHaveValue(
      'Question',
    )
    expect(
      screen.getByRole('spinbutton', { name: 'appDebug.variableConfig.maxLength' }),
    ).toHaveValue(32)
    const defaultInput = screen.getByRole('textbox', {
      name: 'appDebug.variableConfig.defaultValue',
    })
    await user.click(defaultInput)
    await user.keyboard('{Enter}')

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: 'hello' }), undefined)
  })

  it.each([InputVarType.singleFile, InputVarType.multiFiles])(
    'should keep the %s configuration open when Enter adds custom extensions',
    async (type) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      const onClose = vi.fn()
      render(
        <ConfigModal
          isShow
          supportFile
          payload={createPayload({
            type,
            label: 'Attachment',
            default: undefined,
            max_length: 2,
            allowed_file_types: [SupportUploadFileTypes.custom],
            allowed_file_extensions: ['.txt'],
            allowed_file_upload_methods: [TransferMethod.local_file],
          })}
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      )

      const extensionInput = screen.getByPlaceholderText(
        'appDebug.variableConfig.file.custom.createPlaceholder',
      )
      await user.type(extensionInput, '.csv{Enter}')

      expect(screen.getByRole('button', { name: 'common.operation.remove .csv' })).toBeVisible()
      expect(extensionInput).toHaveFocus()
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeVisible()

      await user.type(extensionInput, '.json{Enter}')
      expect(screen.getByRole('button', { name: 'common.operation.remove .json' })).toBeVisible()
      expect(onConfirm).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ allowed_file_extensions: ['.txt', '.csv', '.json'] }),
        undefined,
      )
    },
  )

  it.each([InputVarType.checkbox, InputVarType.select])(
    'should associate the default selector label for %s',
    (type) => {
      render(
        <ConfigModal
          isShow
          payload={createPayload({
            type,
            label: 'Question',
            options: ['alpha'],
            default: undefined,
          })}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      expect(
        screen.getByRole('combobox', { name: 'appDebug.variableConfig.fieldType' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('combobox', { name: 'appDebug.variableConfig.defaultValue' }),
      ).toBeInTheDocument()
    },
  )

  it('should cancel without submitting the form', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <ConfigModal
        isShow
        payload={createPayload({ label: 'Question' })}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('should keep scrolling inside the form body so scrollbars do not cover dialog corners', () => {
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload({ label: 'Question' })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog')
    const scrollArea = screen.getByTestId('config-modal-scroll-area')

    expect(dialog).toHaveClass('overflow-hidden!')
    expect(scrollArea).toHaveClass('overflow-y-auto')
    expect(scrollArea).toHaveClass('overflow-x-hidden')
  })

  it('should block save when the label is missing', () => {
    render(
      <ConfigModal
        isCreate
        isShow
        payload={createPayload({ label: '' })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(toastErrorSpy).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.labelNameRequired')
  })
})
