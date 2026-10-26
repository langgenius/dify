import type { ParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import InputField from '../input-field'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: i18next } = await import('i18next')
  const i18n = i18next.createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: {
      'en-US': {
        workflowHumanInput: {
          nodes: {
            humanInput: {
              insertInputField: {
                prePopulateFieldPlaceholder: '<staticContent/> <variable/>',
              },
            },
          },
        },
      },
    },
  })
  return {
    ...createReactI18nextMock(),
    Trans: (props: React.ComponentProps<typeof actual.Trans>) => (
      <actual.Trans {...props} i18n={i18n} />
    ),
  }
})

const render = (ui: React.ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient, [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const start = createStartNode({ id: 'start', data: { variables: [] } })
  const code = createNode({
    id: 'code',
    data: {
      title: 'Available values',
      type: BlockEnum.Code,
      outputs: {
        text: { type: VarType.string, children: null },
        old_text: { type: VarType.string, children: null },
        choices: { type: VarType.arrayString, children: null },
        files: { type: VarType.arrayFile, children: null },
      },
    },
  })
  const current = createNode({
    id: 'human',
    data: { type: BlockEnum.HumanInput, title: 'Human input' },
  })
  return renderWorkflowFlowComponent(ui, {
    queryClient,
    nodes: [start, code, current],
    edges: [
      createEdge({
        source: 'start',
        target: 'code',
        data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
      }),
      createEdge({
        source: 'code',
        target: 'human',
        data: { sourceType: BlockEnum.Code, targetType: BlockEnum.HumanInput },
      }),
    ],
  })
}

async function configureFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('checkbox', { name: 'appDebug.variableConfig.file.custom.name' }),
  )
  await user.type(
    screen.getByRole('textbox', { name: 'appDebug.variableConfig.file.custom.name' }),
    '.pdf{Enter}',
  )
  await user.click(screen.getByRole('radio', { name: 'appDebug.variableConfig.localUpload' }))
}

const createPayload = (overrides?: Partial<ParagraphFormInput>): ParagraphFormInput => ({
  type: InputVarType.paragraph,
  output_variable_name: 'valid_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'hello',
  },
  ...overrides,
})

describe('InputField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves only from the field surface and ignores composition', () => {
    const onChange = vi.fn()
    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    const input = screen.getByRole('textbox', { name: /saveResponseAs/ })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyUp(input, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(createPayload())
  })

  it('should focus the field type from its visible label and save the selected type', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <InputField
        nodeId="human"
        isEdit
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const label = screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.fieldType')
    const typeSelector = screen.getByRole('combobox', {
      name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
    })
    await user.click(label)
    expect(typeSelector).toHaveFocus()
    await user.click(typeSelector)
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: InputVarType.select, output_variable_name: 'valid_name' }),
    )
  })

  it('should disable save and show validation error when variable name is invalid', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, 'invalid name')

    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.variableNameInvalid'),
    )!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' }))!.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should disable save and show validation error when variable name already exists', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        unavailableVariableNames={['existing_name']}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, 'existing_name')

    expect(
      screen.getByText(
        'workflowHumanInput.nodes.humanInput.insertInputField.variableNameDuplicated',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    ).toBeDisabled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should use default payload when payload is not provided', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<InputField nodeId="human" isEdit={false} onChange={onChange} onCancel={vi.fn()} />)

    const nameInput = screen.getAllByRole('textbox')[0]
    await user.type(nameInput!, 'generated_name')
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.paragraph,
      output_variable_name: 'generated_name',
      default: {
        type: 'constant',
        selector: [],
        value: '',
      },
    })
  })

  it('should save in create mode on Ctrl+Enter and include updated default constant value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'constant',
            selector: [],
            value: 'initial',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    const input = screen.getByRole('textbox', { name: /staticContent/ })
    await user.clear(input)
    await user.type(input, 'constant-default')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'constant',
      selector: [],
      value: 'constant-default',
    })
  })

  it('should switch to constant mode when variable mode type switch is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'variable',
            selector: ['code', 'text'],
            value: '',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByText(
        /workflowHumanInput\.nodes\.humanInput\.insertInputField\.useConstantInstead/i,
      ),
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'constant',
      selector: ['code', 'text'],
      value: '',
    })
  })

  it('should update default selector when variable picker is used', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload({
          default: {
            type: 'variable',
            selector: ['code', 'old_text'],
            value: '',
          },
        })}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Available values.*old_text/ }))
    await user.click(within(await screen.findByRole('dialog')).getByText('text', { exact: true }))
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].default).toEqual({
      type: 'variable',
      selector: ['code', 'text'],
      value: '',
    })
  })

  it('should switch to select payload when field type changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.select,
      output_variable_name: 'valid_name',
      option_source: {
        type: 'constant',
        selector: [],
        value: [],
      },
    })
    expect(
      screen.queryByText(
        /workflowHumanInput\.nodes\.humanInput\.insertInputField\.prePopulateField/i,
      ),
    ).not.toBeInTheDocument()
  })

  it('should keep paragraph pre-populate editor available after switching back to paragraph', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.prePopulateField'),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.single-file\b/ }),
    )
    expect(
      screen.queryByText(
        /workflowHumanInput\.nodes\.humanInput\.insertInputField\.prePopulateField/i,
      ),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.paragraph\b/ }),
    )
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.prePopulateField'),
    ).toBeInTheDocument()
    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.insertInputField.staticContent'),
    )
    await user.type(screen.getByRole('textbox', { name: /staticContent/ }), 'Restored default')
    await user.click(screen.getByRole('button', { name: /insertInputField\.insert/i }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      type: InputVarType.paragraph,
      output_variable_name: 'valid_name',
      default: { type: 'constant', selector: [], value: 'Restored default' },
    })
  })

  it('should save constant select options', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' }),
      'alpha',
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }),
      'beta',
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.select,
      output_variable_name: 'valid_name',
      option_source: {
        type: 'constant',
        selector: [],
        value: ['alpha', 'beta'],
      },
    })
  })

  it('should preserve constant and variable select sources when toggling', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' }),
      'alpha',
    )
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }),
      'beta',
    )
    await user.click(
      screen.getByText(/workflowHumanInput\.nodes\.humanInput\.insertInputField\.useVarInstead/i),
    )
    await user.click(screen.getByRole('button', { name: /common.setVarValuePlaceholder/ }))
    await user.click(await screen.findByText('choices'))
    await user.click(
      screen.getByText(
        /workflowHumanInput\.nodes\.humanInput\.insertInputField\.useConstantInstead/i,
      ),
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.select,
      output_variable_name: 'valid_name',
      option_source: {
        type: 'constant',
        selector: ['code', 'choices'],
        value: ['alpha', 'beta'],
      },
    })
  })

  it('should only allow array[string] variables for select option source', async () => {
    const user = userEvent.setup()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.select\b/ }),
    )
    await user.click(
      screen.getByText(/workflowHumanInput\.nodes\.humanInput\.insertInputField\.useVarInstead/i),
    )

    await user.click(screen.getByRole('button', { name: /common.setVarValuePlaceholder/ }))
    expect(await screen.findByText('choices')).toBeInTheDocument()
    expect(screen.queryByText('text', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('files', { exact: true })).not.toBeInTheDocument()
  })

  it('should save single file upload settings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.single-file\b/ }),
    )
    await configureFile(user)
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.singleFile,
      output_variable_name: 'valid_name',
      allowed_file_extensions: ['.pdf'],
      allowed_file_types: ['custom'],
      allowed_file_upload_methods: ['local_file'],
    })
  })

  it('should save file-list upload settings and max upload count', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.multi-files\b/ }),
    )
    await configureFile(user)
    const limit = screen.getByRole('spinbutton', {
      name: 'appDebug.variableConfig.maxNumberOfUploads',
    })
    await user.click(limit)
    await user.tab()
    expect(screen.getByRole('slider')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual({
      type: InputVarType.multiFiles,
      output_variable_name: 'valid_name',
      allowed_file_extensions: ['.pdf'],
      allowed_file_types: ['custom'],
      allowed_file_upload_methods: ['local_file'],
      number_limits: 4,
    })
  })

  it('should normalize empty file-list upload limit on save', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <InputField
        nodeId="human"
        isEdit={false}
        payload={createPayload()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'workflowHumanInput.nodes.humanInput.insertInputField.fieldType',
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: /appDebug\.variableConfig\.multi-files\b/ }),
    )
    await user.clear(
      screen.getByRole('spinbutton', {
        name: 'appDebug.variableConfig.maxNumberOfUploads',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput\.nodes\.humanInput\.insertInputField\.insert/i,
      }),
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        type: InputVarType.multiFiles,
        number_limits: 1,
      }),
    )
  })
})
