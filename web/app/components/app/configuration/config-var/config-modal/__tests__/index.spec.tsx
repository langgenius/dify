import type { InputVar } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { toast } from '@/app/components/app/configuration/toast'
import { useStore } from '@/app/components/app/store'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { commonQueryKeys } from '@/service/use-common'
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

vi.mock('@monaco-editor/react', async () => ({
  ...(await vi.importActual<typeof import('@monaco-editor/react')>('@monaco-editor/react')),
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="JSON schema editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
    expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.maxLength' })).toHaveValue(
      '32',
    )
    const defaultInput = screen.getByRole('textbox', {
      name: 'appDebug.variableConfig.defaultValue',
    })
    await user.click(defaultInput)
    await user.keyboard('{Enter}')

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: 'hello' }), undefined)
  })

  it('should normalize spaces in the variable name and fill an empty label on blur', async () => {
    const user = userEvent.setup()
    render(
      <ConfigModal
        isShow
        payload={createPayload({ variable: '', label: '' })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const variable = screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })
    await user.type(variable, 'search query')
    await user.tab()

    expect(variable).toHaveValue('search_query')
    expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })).toHaveValue(
      'search_query',
    )
  })

  it.each(['0', 0])(
    'should edit a numeric default initialized from %s without losing decimal precision',
    async (initialDefault) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <ConfigModal
          isShow
          payload={createPayload({
            type: InputVarType.number,
            label: 'Amount',
            default: initialDefault,
          })}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      const input = screen.getByRole('textbox', { name: 'appDebug.variableConfig.defaultValue' })
      expect(input).toHaveValue('0')
      await user.click(screen.getByText('appDebug.variableConfig.defaultValue'))
      expect(input).toHaveFocus()
      await user.clear(input)
      await user.type(input, '-7.123456')
      await user.tab()
      expect(input).toHaveValue('-7.123456')
      await user.click(input)
      await user.keyboard('{Enter}')

      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ default: -7.123456 }),
        undefined,
      )
    },
  )

  it.each([
    { option: 'appDebug.variableConfig.text-input string', type: InputVarType.textInput },
    { option: 'appDebug.variableConfig.paragraph string', type: InputVarType.paragraph },
  ])('should preserve a numeric default when switching to $type', async ({ option, type }) => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfigModal
        isShow
        payload={createPayload({ type: InputVarType.number, label: 'Amount', default: -7.123456 })}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'appDebug.variableConfig.fieldType' }))
    await user.click(await screen.findByRole('option', { name: option }))
    expect(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.defaultValue' }),
    ).toHaveValue('-7.123456')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type, default: '-7.123456' }),
      undefined,
    )
  })

  it.each([
    { initialDefault: '0', expected: 0, displayed: '0' },
    { initialDefault: 'hello', expected: undefined, displayed: '' },
  ])(
    'should use a numeric or absent default when switching from "$initialDefault" to number',
    async ({ initialDefault, expected, displayed }) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <ConfigModal
          isShow
          payload={createPayload({ label: 'Question', default: initialDefault })}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      await user.click(screen.getByRole('combobox', { name: 'appDebug.variableConfig.fieldType' }))
      await user.click(
        await screen.findByRole('option', { name: 'appDebug.variableConfig.number number' }),
      )
      expect(
        screen.getByRole('textbox', { name: 'appDebug.variableConfig.defaultValue' }),
      ).toHaveValue(displayed)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ type: InputVarType.number, default: expected }),
        undefined,
      )
    },
  )

  it.each([InputVarType.textInput, InputVarType.number])(
    'should save an absent %s default after clearing it',
    async (type) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <ConfigModal
          isShow
          payload={createPayload({
            type,
            label: 'Question',
            default: type === InputVarType.number ? 9 : 'hello',
          })}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      const input = screen.getByRole('textbox', { name: 'appDebug.variableConfig.defaultValue' })
      await user.clear(input)
      await user.tab()
      expect(input).toHaveValue('')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ default: undefined }),
        undefined,
      )
    },
  )

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

  it.each(['Enter', 'Save'])(
    'should fill an empty upload count on %s submission',
    async (method) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <ConfigModal
          isShow
          supportFile
          payload={createPayload({
            type: InputVarType.multiFiles,
            label: 'Attachment',
            default: undefined,
            max_length: 2,
            allowed_file_types: [SupportUploadFileTypes.document],
            allowed_file_upload_methods: [TransferMethod.local_file],
          })}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      const count = screen.getByRole('spinbutton', {
        name: 'appDebug.variableConfig.maxNumberOfUploads',
      })
      await user.click(count)
      await user.clear(count)
      expect(count).toHaveFocus()
      if (method === 'Enter') await user.keyboard('{Enter}')
      else await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ max_length: 1 }),
        undefined,
      )
    },
  )

  it('should clamp the upload count to the current cached server limit on submission', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { queryClient } = render(
      <ConfigModal
        isShow
        supportFile
        payload={createPayload({
          type: InputVarType.multiFiles,
          label: 'Attachment',
          default: undefined,
          max_length: 5,
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
        })}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    queryClient.setQueryData(commonQueryKeys.fileUploadConfig, {
      batch_count_limit: 5,
      image_file_batch_limit: 10,
      single_chunk_attachment_limit: 10,
      attachment_image_file_size_limit: 2,
      file_size_limit: 15,
      file_upload_limit: 5,
      workflow_file_upload_limit: 3,
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ max_length: 3 }),
      undefined,
    )
  })

  it.each([
    { field: 'variable', name: 'appDebug.variableConfig.varName' },
    { field: 'label', name: 'appDebug.variableConfig.labelName' },
  ] as const)(
    'should focus and describe the invalid $field and clear its error after editing',
    async ({ field, name }) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <ConfigModal
          isShow
          payload={createPayload({ label: field === 'variable' ? '' : 'Question', [field]: '' })}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      const input = screen.getByRole('textbox', { name })
      const save = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(save)
      expect(input).toHaveFocus()
      expect(input).toBeInvalid()
      expect(input).toHaveAccessibleDescription(toastErrorSpy.mock.lastCall![0])
      expect(onConfirm).not.toHaveBeenCalled()

      // Repeated invalid submissions must restore focus as well.
      await user.click(save)
      expect(input).toHaveFocus()
      await user.type(input, 'question')
      expect(input).not.toBeInvalid()
      expect(input).not.toHaveAttribute('aria-describedby')
      await user.click(save)
      expect(onConfirm).toHaveBeenCalledOnce()
    },
  )

  it.each([{ options: [] }, { options: ['alpha', 'alpha'] }])(
    'should associate option errors and focus an action or input',
    async ({ options }) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <ConfigModal
          isShow
          payload={createPayload({
            type: InputVarType.select,
            label: 'Question',
            options,
            default: undefined,
          })}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      const control = options.length
        ? screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' })
        : screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' })
      expect(control).toHaveFocus()
      expect(control).toHaveAttribute('aria-invalid', 'true')
      expect(control).toHaveAccessibleDescription(toastErrorSpy.mock.lastCall![0])
      expect(onConfirm).not.toHaveBeenCalled()
    },
  )

  it.each([
    { types: [], role: 'checkbox', name: 'appDebug.variableConfig.file.document.name' },
    {
      types: [SupportUploadFileTypes.custom],
      role: 'textbox',
      name: 'appDebug.variableConfig.file.custom.name',
    },
  ])(
    'should focus and describe file configuration errors for $name',
    async ({ types, role, name }) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <ConfigModal
          isShow
          supportFile
          payload={createPayload({
            type: InputVarType.singleFile,
            label: 'Attachment',
            default: undefined,
            allowed_file_types: types,
            allowed_file_extensions: [],
            allowed_file_upload_methods: [TransferMethod.local_file],
          })}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      const control = screen.getByRole(role, { name })
      expect(control).toHaveFocus()
      expect(control).toHaveAttribute('aria-invalid', 'true')
      expect(control).toHaveAccessibleDescription(toastErrorSpy.mock.lastCall![0])
      expect(onConfirm).not.toHaveBeenCalled()

      if (role === 'textbox') await user.type(control, '.csv{Enter}')
      else await user.click(control)
      expect(control).not.toHaveAttribute('aria-invalid')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(onConfirm).toHaveBeenCalledOnce()
    },
  )

  it('should validate the current JSON draft and associate the error with the editor group', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfigModal
        isShow
        payload={createPayload({
          type: InputVarType.jsonObject,
          label: 'Question',
          json_schema: '{"type":"object"}',
        })}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const editor = screen.getByRole('textbox', { name: 'JSON schema editor' })
    await user.click(editor)
    await user.clear(editor)
    await user.paste('{invalid}')
    expect(editor).toHaveValue('{invalid}')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    const group = screen.getByRole('group', { name: /appDebug.variableConfig.jsonSchema/ })
    expect(group).toHaveFocus()
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAccessibleDescription('appDebug.variableConfig.errorMsg.jsonSchemaInvalid')
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(editor)
    await user.clear(editor)
    await user.paste('{"type":"object"}')
    expect(group).not.toHaveAttribute('aria-invalid')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ json_schema: JSON.stringify({ type: 'object' }, null, 2) }),
      undefined,
    )
  })

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
