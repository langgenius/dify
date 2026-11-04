import type { TFunction } from 'i18next'
import type { ChangeEvent, ReactNode } from 'react'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar, UploadFileSetting } from '@/app/components/workflow/types'
import type { consoleClient } from '@/service/console'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { withSelectorKey } from '@/test/i18n-mock'
import { TransferMethod } from '@/types/app'
import ConfigModalFormFields from '../form-fields'

vi.mock('react-i18next', async () => {
  const { withSelectorKey, withSelectorKeyProps } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
        const ns = options?.ns as string | undefined
        return ns ? `${ns}.${key}` : key
      }) as TFunction<['appDebug']>,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: withSelectorKeyProps(
      ({ i18nKey, components }: { i18nKey: string; components?: Record<string, ReactNode> }) => (
        <span data-i18n-key={i18nKey}>
          {i18nKey}
          {components?.docLink}
        </span>
      ),
    ),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.example.com${path || ''}`,
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/',
}))

const remoteUpload = vi.hoisted(() =>
  vi.fn<
    (url: string) => Promise<{
      id: string
      name: string
      size: number
      mime_type: string
      url: string
      created_at: null
      created_by: null
      extension: string
    }>
  >(),
)

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createFileUploadConfigFixture } = await import('@/test/fixtures/file-upload-config')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': async () => createFileUploadConfigFixture(),
      'remoteFiles.upload.post': ({
        body,
      }: Parameters<typeof consoleClient.remoteFiles.upload.post>[0]) => remoteUpload(body.url),
    }),
  }
})

const t = withSelectorKey((key: string) => key) as TFunction<['appDebug']>

const basePayload: InputVar = {
  type: InputVarType.textInput,
  label: 'Question',
  variable: 'question',
  required: false,
  hide: false,
}

const selectOptions = [
  { value: InputVarType.textInput, name: 'Text' },
  { value: InputVarType.select, name: 'Select' },
  { value: InputVarType.checkbox, name: 'Checkbox' },
]

type ControlledFieldsProps = {
  initialPayload?: InputVar
  options?: string[]
  showHiddenField?: boolean
}

function ControlledFields({
  initialPayload = basePayload,
  options,
  showHiddenField,
}: ControlledFieldsProps) {
  const [tempPayload, setTempPayload] = useState(initialPayload)

  const setPayloadValue = (key: string) => (value: unknown) => {
    setTempPayload((payload) => ({ ...payload, [key]: value }) as InputVar)
  }

  return (
    <>
      <ConfigModalFormFields
        checkboxDefaultSelectValue={tempPayload.default === true ? 'true' : 'false'}
        isStringInput={false}
        jsonSchemaStr=""
        maxLength={32}
        modelId="gpt-4o"
        onFilePayloadChange={(payload: UploadFileSetting) =>
          setTempPayload((current) => ({ ...current, ...payload }))
        }
        onJSONSchemaChange={() => undefined}
        onPayloadChange={setPayloadValue}
        onTypeChange={(item) => setTempPayload((payload) => ({ ...payload, type: item.value }))}
        onVarKeyBlur={() => undefined}
        onVarNameChange={(event: ChangeEvent<HTMLInputElement>) =>
          setTempPayload((payload) => ({ ...payload, variable: event.target.value }))
        }
        options={options}
        selectOptions={selectOptions}
        showHiddenField={showHiddenField}
        tempPayload={tempPayload}
        t={t}
      />
      <output aria-label="Saved variable">{JSON.stringify(tempPayload)}</output>
    </>
  )
}

function getSavedVariable() {
  return JSON.parse(screen.getByLabelText('Saved variable').textContent || '{}') as InputVar
}

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'report.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.remote_url,
  supportFileType: 'document',
  uploadedId: 'uploaded-file-1',
  url: 'https://example.com/report.txt',
  isRemote: true,
  ...overrides,
})

async function uploadRemoteFile(user: ReturnType<typeof userEvent.setup>, url: string) {
  let input = screen.queryByPlaceholderText('common.fileUploader.pasteFileLinkInputPlaceholder')
  if (!input) {
    await user.click(screen.getByRole('button', { name: /fileUploader.pasteFileLink/ }))
    input = screen.getByPlaceholderText('common.fileUploader.pasteFileLinkInputPlaceholder')
  }
  await user.type(input, url)
  await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
}

describe('ConfigModalFormFields', () => {
  beforeEach(() => {
    remoteUpload.mockImplementation(async (url) => ({
      id: url.includes('second') ? 'uploaded-file-2' : 'uploaded-file-1',
      name: url.split('/').at(-1) || 'report.txt',
      size: 1024,
      mime_type: 'text/plain',
      url,
      created_at: null,
      created_by: null,
      extension: 'txt',
    }))
  })

  it.each([
    {
      type: InputVarType.textInput,
      label: 'variableConfig.fieldType',
      option: 'Select',
      expected: 'Select',
    },
    {
      type: InputVarType.checkbox,
      label: 'variableConfig.defaultValue',
      option: 'variableConfig.startChecked',
      expected: 'true',
    },
    {
      type: InputVarType.select,
      label: 'variableConfig.defaultValue',
      option: 'beta',
      expected: 'beta',
    },
  ])(
    'should focus the $type selector from its label and select an option',
    async ({ type, label, option, expected }) => {
      const user = userEvent.setup()
      render(
        <ControlledFields initialPayload={{ ...basePayload, type }} options={['alpha', 'beta']} />,
      )

      await user.click(screen.getByText(label))
      const trigger = screen.getByRole('combobox', { name: label })
      expect(trigger).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      await user.click(await screen.findByRole('option', { name: new RegExp(`^${option}`) }))

      if (type === InputVarType.textInput)
        expect(screen.getByText('variableConfig.options')).toBeInTheDocument()
      else expect(screen.getByRole('combobox', { name: label })).toHaveTextContent(expected)
    },
  )

  it('should hide visibility controls for file inputs and save scalar and list defaults', async () => {
    const user = userEvent.setup()
    const textInputView = render(<ControlledFields />)
    expect(screen.getByText('variableConfig.hidden')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'variableConfig.hidden' }))
    expect(await screen.findByText('variableConfig.hiddenDescription')).toBeInTheDocument()
    expect(await screen.findByRole('link')).toHaveAttribute(
      'href',
      'https://docs.example.com/use-dify/nodes/user-input#hide-and-pre-fill-input-fields',
    )
    textInputView.unmount()

    const hiddenFieldDisabledView = render(<ControlledFields showHiddenField={false} />)
    expect(screen.queryByText('variableConfig.hidden')).not.toBeInTheDocument()
    hiddenFieldDisabledView.unmount()

    const singleFileView = render(
      <ControlledFields
        initialPayload={{
          ...basePayload,
          type: InputVarType.singleFile,
          allowed_file_types: ['document'],
          allowed_file_extensions: [],
          allowed_file_upload_methods: [TransferMethod.remote_url],
        }}
      />,
    )
    expect(screen.queryByText('variableConfig.hidden')).not.toBeInTheDocument()
    await uploadRemoteFile(user, 'https://example.com/first.txt')
    await waitFor(() =>
      expect(getSavedVariable().default).toEqual(
        expect.objectContaining({ uploadedId: 'uploaded-file-1' }),
      ),
    )
    expect(Array.isArray(getSavedVariable().default)).toBe(false)
    expect(screen.getByText('https://example.com/first.txt')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'variableConfig.required' }))
    expect(screen.getByRole('checkbox', { name: 'variableConfig.required' })).toBeChecked()
    singleFileView.unmount()

    render(
      <ControlledFields
        initialPayload={{
          ...basePayload,
          type: InputVarType.multiFiles,
          allowed_file_types: ['document'],
          allowed_file_extensions: [],
          allowed_file_upload_methods: [TransferMethod.remote_url],
        }}
      />,
    )
    await uploadRemoteFile(user, 'https://example.com/first.txt')
    await waitFor(() =>
      expect(getSavedVariable().default).toEqual([
        expect.objectContaining({ uploadedId: 'uploaded-file-1' }),
      ]),
    )
    await uploadRemoteFile(user, 'https://example.com/second.txt')
    await waitFor(() =>
      expect(getSavedVariable().default).toEqual([
        expect.objectContaining({ uploadedId: 'uploaded-file-1' }),
        expect.objectContaining({ uploadedId: 'uploaded-file-2' }),
      ]),
    )
    expect(screen.getByText('https://example.com/first.txt')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/second.txt')).toBeInTheDocument()
  })

  it('should clear select defaults and show an empty real uploader', async () => {
    const user = userEvent.setup()
    const selectView = render(
      <ControlledFields
        initialPayload={{ ...basePayload, type: InputVarType.select, default: 'alpha' }}
        options={['alpha', ' ', 'beta']}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'variableConfig.defaultValue' }))
    await user.click(await screen.findByRole('option', { name: 'variableConfig.noDefaultValue' }))
    expect(getSavedVariable()).not.toHaveProperty('default')
    selectView.unmount()

    render(
      <ControlledFields
        initialPayload={{ ...basePayload, type: InputVarType.singleFile, default: undefined }}
      />,
    )
    expect(screen.getByRole('button', { name: /fileUploader.pasteFileLink/ })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: /common.operation.remove/ }),
    ).not.toBeInTheDocument()
  })

  it('should skip rendering the default selector when options are missing', () => {
    render(<ControlledFields initialPayload={{ ...basePayload, type: InputVarType.select }} />)

    expect(
      screen.queryByRole('combobox', { name: 'variableConfig.defaultValue' }),
    ).not.toBeInTheDocument()
  })

  it('should preserve supported file defaults when present', () => {
    const singleFile = createFile({ id: 'existing-file', name: 'existing.txt' })
    const singleFileView = render(
      <ControlledFields
        initialPayload={{
          ...basePayload,
          type: InputVarType.singleFile,
          default: singleFile,
        }}
      />,
    )
    expect(screen.getByText('existing.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fileUploader.pasteFileLink/ })).toBeDisabled()
    singleFileView.unmount()

    const existingFiles = [
      createFile({ id: 'file-1', name: 'first.txt' }),
      createFile({ id: 'file-2', name: 'second.txt', uploadedId: 'uploaded-file-2' }),
    ]
    render(
      <ControlledFields
        initialPayload={{
          ...basePayload,
          type: InputVarType.multiFiles,
          default: existingFiles,
          max_length: 2,
        }}
      />,
    )
    expect(screen.getByText('first.txt')).toBeInTheDocument()
    expect(screen.getByText('second.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fileUploader.pasteFileLink/ })).toBeDisabled()
  })

  it('should disable hide when required becomes true and disable required when hidden', async () => {
    const user = userEvent.setup()
    const requiredView = render(<ControlledFields />)
    await user.click(screen.getByRole('checkbox', { name: 'variableConfig.required' }))
    expect(screen.getByRole('checkbox', { name: 'variableConfig.required' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'variableConfig.hidden' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    requiredView.unmount()

    render(<ControlledFields initialPayload={{ ...basePayload, hide: true }} />)
    expect(screen.getByRole('checkbox', { name: 'variableConfig.required' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('checkbox', { name: 'variableConfig.hidden' })).toBeChecked()
  })
})
