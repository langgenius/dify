import type {
  CredentialFormSchema,
  CredentialFormSchemaBase,
  CredentialFormSchemaNumberInput,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  FormValue,
} from '../../declarations'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { MCPToolAvailabilityProvider } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { FormTypeEnum } from '../../declarations'
import Form from '../Form'

type CustomSchema = Omit<CredentialFormSchemaBase, 'type'> & { type: 'custom-type' }

const mockLanguageRef = { value: 'en_US' }

const render = createNuqsTestRenderer((ui) => {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: false },
  })
  seedAppDslVersion(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [
      createToolProviderFixture({
        id: 'search-provider',
        name: 'search',
        label: { en_US: 'Search provider' },
        is_team_authorization: true,
        allow_delete: false,
        tools: [
          {
            name: 'search',
            author: 'Dify',
            label: { en_US: 'Search Tool' },
            description: { en_US: 'Find documents' },
            parameters: [],
          },
        ],
      }),
    ],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-1',
          label: { en_US: 'gpt-1' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  return renderWorkflowFlowComponent(
    <MCPToolAvailabilityProvider versionSupported>{ui}</MCPToolAvailabilityProvider>,
    {
      queryClient,
      nodes: [
        createNode({
          id: 'source',
          data: {
            type: BlockEnum.Code,
            title: 'Source',
            outputs: {
              text: { type: VarType.string },
              count: { type: VarType.number },
              enabled: { type: VarType.boolean },
            },
          },
        }),
        createNode({ id: 'node-current', data: { type: BlockEnum.Code, title: 'Current' } }),
      ],
      edges: [createEdge({ source: 'source', target: 'node-current' })],
    },
  )
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': async () => ({
        data: [createAppDetailFixture({ id: 'selected-app', name: 'Support Bot', mode: 'chat' })],
        page: 1,
        limit: 20,
        has_more: false,
      }),
      'apps.byAppId.get': async () =>
        createAppDetailFixture({
          id: 'selected-app',
          name: 'Support Bot',
          mode: 'chat',
          model_config: createAppModelConfigFixture({ user_input_form: [] }),
        }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': async () => ({
        data: [
          {
            name: 'temperature',
            label: { en_US: 'Temperature' },
            type: 'float',
            min: 0,
            max: 1,
            default: 0.7,
          },
        ],
      }),
    }),
  }
})
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useLanguage: () => mockLanguageRef.value,
}))

async function chooseTool(user: ReturnType<typeof userEvent.setup>, alreadyOpen: boolean) {
  if (!alreadyOpen)
    await user.click(
      screen.getByRole('button', { name: 'plugin.detailPanel.toolSelector.placeholder' }),
    )
  await user.click(await screen.findByRole('button', { name: /Search provider/ }))
  await user.click(await screen.findByText('Search Tool'))
}

const createI18n = (text: string) => ({ en_US: text, zh_Hans: text })
const createPartialI18n = (text: string) =>
  ({ en_US: text }) as unknown as ReturnType<typeof createI18n>

const createBaseSchema = (
  type: FormTypeEnum,
  overrides: Partial<CredentialFormSchemaBase> = {},
): CredentialFormSchemaBase => ({
  name: overrides.variable ?? 'field',
  variable: overrides.variable ?? 'field',
  label: createI18n('Field'),
  type,
  required: false,
  show_on: [],
  ...overrides,
})

const createTextSchema = (
  overrides: Partial<CredentialFormSchemaTextInput> & { type?: FormTypeEnum },
) => ({
  ...createBaseSchema(overrides.type ?? FormTypeEnum.textInput, {
    variable: overrides.variable ?? 'text',
  }),
  placeholder: createI18n('Input'),
  ...overrides,
})

const createNumberSchema = (overrides: Partial<CredentialFormSchemaNumberInput>) => ({
  ...createBaseSchema(FormTypeEnum.textNumber, { variable: overrides.variable ?? 'number' }),
  placeholder: createI18n('Number'),
  min: 1,
  max: 9,
  ...overrides,
})

const createRadioSchema = (overrides: Partial<CredentialFormSchemaRadio>) => ({
  ...createBaseSchema(FormTypeEnum.radio, { variable: overrides.variable ?? 'radio' }),
  options: [
    { label: createI18n('Option A'), value: 'a', show_on: [] },
    { label: createI18n('Option B'), value: 'b', show_on: [] },
  ],
  ...overrides,
})

const createSelectSchema = (overrides: Partial<CredentialFormSchemaSelect>) => ({
  ...createBaseSchema(FormTypeEnum.select, { variable: overrides.variable ?? 'select' }),
  placeholder: createI18n('Select one'),
  options: [
    { label: createI18n('Select A'), value: 'a', show_on: [] },
    { label: createI18n('Select B'), value: 'b', show_on: [] },
  ],
  ...overrides,
})

type Props = React.ComponentProps<typeof Form>
const defaults = {
  validating: false,
  showOnVariableMap: {},
  isEditMode: false,
  nodeId: 'node-current',
}
function Harness({
  initialValue = {},
  onChange = () => {},
  ...props
}: Omit<Props, 'value' | 'onChange'> & {
  initialValue?: FormValue
  onChange?: Props['onChange']
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <Form
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('Form', () => {
  beforeEach(() => {
    mockLanguageRef.value = 'en_US'
  })

  it.each([
    ['', true, 'default'],
    [null, true, 'default'],
    [undefined, true, 'default'],
    ['actual', true, 'actual'],
    ['', false, ''],
  ] as const)('displays text value %s with defaults %s', (value, showDefault, expected) => {
    render(
      <Harness
        {...defaults}
        initialValue={{ field: value }}
        isShowDefaultValue={showDefault}
        formSchemas={[
          createTextSchema({ variable: 'field', label: createI18n('Key'), default: 'default' }),
        ]}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveValue(expected)
  })

  it.each(['', null, undefined])('selects the default option for empty value %s', (value) => {
    render(
      <Harness
        {...defaults}
        initialValue={{ field: value }}
        isShowDefaultValue
        formSchemas={[
          createSelectSchema({ variable: 'field', label: createI18n('Model'), default: 'b' }),
        ]}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Select B')
  })

  it('keeps secrets masked and preserves numeric zero instead of replacing it with a default', () => {
    render(
      <Harness
        {...defaults}
        initialValue={{ secret: 'private', number: 0 }}
        isShowDefaultValue
        formSchemas={[
          createTextSchema({
            variable: 'secret',
            label: createI18n('Secret'),
            type: FormTypeEnum.secretInput,
          }),
          createNumberSchema({
            variable: 'number',
            label: createI18n('Limit'),
            default: '5',
            min: 0,
          }),
        ]}
      />,
    )
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Secret')).toHaveValue('private')
    expect(screen.getByRole('spinbutton', { name: 'Limit' })).toHaveValue(0)
    expect(screen.getByRole('spinbutton', { name: 'Limit' })).toHaveAttribute('min', '0')
    expect(screen.getByRole('spinbutton', { name: 'Limit' })).toHaveAttribute('max', '9')
  })

  it('resets dependent fields while preserving unrelated edits', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Harness
        {...defaults}
        onChange={onChange}
        initialValue={{ key: 'old', dependent: 'keep', missing: 'stale', other: 'untouched' }}
        showOnVariableMap={{ key: ['dependent', 'missing'] }}
        formSchemas={[
          createTextSchema({ variable: 'key', label: createI18n('Key') }),
          createTextSchema({
            variable: 'dependent',
            label: createI18n('Dependent'),
            default: 'reset',
          }),
        ]}
      />,
    )
    await user.clear(screen.getByRole('textbox', { name: 'Key' }))
    await user.type(screen.getByRole('textbox', { name: 'Key' }), 'new')
    expect(onChange).toHaveBeenLastCalledWith({
      key: 'new',
      dependent: 'reset',
      missing: undefined,
      other: 'untouched',
    })
    expect(screen.getByRole('textbox', { name: 'Dependent' })).toHaveValue('reset')
  })

  it.each([FormTypeEnum.textInput, FormTypeEnum.radio, FormTypeEnum.select, FormTypeEnum.checkbox])(
    'changes visibility of %s fields when their dependency changes',
    async (type) => {
      const user = userEvent.setup()
      const conditional = {
        variable: 'conditional',
        label: createI18n('Conditional'),
        show_on: [{ variable: 'toggle', value: 'on' }],
      }
      const schema =
        type === FormTypeEnum.radio || type === FormTypeEnum.checkbox
          ? createRadioSchema({ ...conditional, type })
          : type === FormTypeEnum.select
            ? createSelectSchema(conditional)
            : createTextSchema(conditional)
      render(
        <Harness
          {...defaults}
          initialValue={{ toggle: '' }}
          formSchemas={[
            createTextSchema({ variable: 'toggle', label: createI18n('Toggle') }),
            schema,
          ]}
        />,
      )
      expect(screen.queryAllByText('Conditional')).toHaveLength(0)
      await user.type(screen.getByRole('textbox', { name: 'Toggle' }), 'on')
      expect(screen.getAllByText('Conditional').length).toBeGreaterThan(0)
      await user.clear(screen.getByRole('textbox', { name: 'Toggle' }))
      expect(screen.queryAllByText('Conditional')).toHaveLength(0)
    },
  )

  it.each([FormTypeEnum.radio, FormTypeEnum.select])(
    'filters %s options before selection',
    async (type) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const options = [
        { label: createI18n('Allowed'), value: 'a', show_on: [] },
        {
          label: createI18n('Blocked'),
          value: 'b',
          show_on: [{ variable: 'toggle', value: 'yes' }],
        },
      ]
      render(
        <Harness
          {...defaults}
          onChange={onChange}
          initialValue={{ toggle: 'no', field: '' }}
          formSchemas={[
            type === FormTypeEnum.radio
              ? createRadioSchema({ variable: 'field', options })
              : createSelectSchema({ variable: 'field', options }),
          ]}
        />,
      )
      if (type === FormTypeEnum.select) await user.click(screen.getByRole('combobox'))
      expect(
        screen.queryByRole(type === FormTypeEnum.select ? 'option' : 'radio', { name: 'Blocked' }),
      ).not.toBeInTheDocument()
      await user.click(
        screen.getByRole(type === FormTypeEnum.select ? 'option' : 'radio', { name: 'Allowed' }),
      )
      expect(onChange).toHaveBeenLastCalledWith({ toggle: 'no', field: 'a' })
    },
  )

  it('retains the selected model while changing a boolean field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Harness
        {...defaults}
        onChange={onChange}
        initialValue={{ model: 'a', agree: false }}
        formSchemas={[
          createSelectSchema({ variable: 'model', label: createI18n('Model') }),
          createRadioSchema({
            variable: 'agree',
            type: FormTypeEnum.checkbox,
            label: createI18n('Agree'),
          }),
        ]}
      />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.click(screen.getByRole('option', { name: 'Select B' }))
    await user.click(screen.getByRole('radio', { name: 'True' }))
    expect(onChange).toHaveBeenLastCalledWith({ model: 'b', agree: true })
    expect(screen.getByRole('combobox')).toHaveTextContent('Select B')
    expect(screen.getByRole('radio', { name: 'True' })).toBeChecked()
  })

  it.each(['__model_name', '__model_type'])(
    'locks %s in edit mode while other fields remain editable',
    async (variable) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Harness
          {...defaults}
          isEditMode
          onChange={onChange}
          initialValue={{ [variable]: 'original', other: '' }}
          formSchemas={[
            createTextSchema({ variable, label: createI18n('Locked') }),
            createTextSchema({ variable: 'other', label: createI18n('Other') }),
          ]}
        />,
      )
      expect(screen.getByRole('textbox', { name: 'Locked' })).toBeDisabled()
      await user.type(screen.getByRole('textbox', { name: 'Locked' }), 'replacement')
      await user.type(screen.getByRole('textbox', { name: 'Other' }), 'new')
      expect(onChange).toHaveBeenLastCalledWith({ [variable]: 'original', other: 'new' })
    },
  )

  it.each([
    FormTypeEnum.radio,
    FormTypeEnum.checkbox,
    FormTypeEnum.select,
    FormTypeEnum.textInput,
    FormTypeEnum.modelSelector,
    FormTypeEnum.toolSelector,
    FormTypeEnum.multiToolSelector,
    FormTypeEnum.appSelector,
    FormTypeEnum.any,
  ])('prevents changes to readonly %s fields', async (type) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const schema =
      type === FormTypeEnum.radio || type === FormTypeEnum.checkbox
        ? createRadioSchema({ type })
        : type === FormTypeEnum.select
          ? createSelectSchema({})
          : createTextSchema({ type })
    render(<Harness {...defaults} readonly onChange={onChange} formSchemas={[schema]} />)
    if (type === FormTypeEnum.multiToolSelector) {
      expect(
        screen.queryByRole('button', { name: 'plugin.detailPanel.toolSelector.title' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('plugin.detailPanel.toolSelector.empty')).toBeInTheDocument()
      return
    }
    if (type === FormTypeEnum.any || type === FormTypeEnum.toolSelector) {
      await user.click(
        screen.getByText(
          type === FormTypeEnum.any
            ? 'workflow.common.setVarValuePlaceholder'
            : 'plugin.detailPanel.configureTool',
        ),
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
      return
    }
    const controls = screen
      .queryAllByRole('radio')
      .concat(
        screen.queryAllByRole('combobox'),
        screen.queryAllByRole('textbox'),
        screen.queryAllByRole('button'),
      )
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      if (control.getAttribute('role') === 'radio')
        expect(control).toHaveAttribute('aria-disabled', 'true')
      else expect(control).toBeDisabled()
      await user.click(control)
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    [
      FormTypeEnum.modelSelector,
      'plugin.detailPanel.configureModel',
      {
        model: 'gpt-1',
        model_type: 'llm',
        provider: 'openai',
        mode: 'chat',
        completion_params: {},
        type: FormTypeEnum.modelSelector,
      },
    ],
    [
      FormTypeEnum.toolSelector,
      'plugin.detailPanel.configureTool',
      expect.objectContaining({ provider_name: 'search-provider', tool_name: 'search' }),
    ],
    [
      FormTypeEnum.multiToolSelector,
      'plugin.detailPanel.toolSelector.title',
      [expect.objectContaining({ provider_name: 'search-provider', tool_name: 'search' })],
    ],
    [
      FormTypeEnum.appSelector,
      'app.appSelector.placeholder',
      { app_id: 'selected-app', inputs: {}, files: [], type: FormTypeEnum.appSelector },
    ],
    [FormTypeEnum.any, 'workflow.common.setVarValuePlaceholder', ['source', 'text']],
  ] as const)(
    'accepts %s selection and resets dependent values',
    async (type, button, expected) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Harness
          {...defaults}
          onChange={onChange}
          initialValue={{ selected: null, dependent: 'stale' }}
          showOnVariableMap={{ selected: ['dependent'] }}
          formSchemas={[
            createTextSchema({ variable: 'selected', type }),
            createTextSchema({ variable: 'dependent', default: 'reset' }),
          ]}
        />,
      )
      await user.click(
        screen.getByRole('button', {
          name: type === FormTypeEnum.any ? /workflow.common.setVarValuePlaceholder/ : button,
        }),
      )
      if (type === FormTypeEnum.toolSelector || type === FormTypeEnum.multiToolSelector)
        await chooseTool(user, type === FormTypeEnum.multiToolSelector)
      if (type === FormTypeEnum.any) await user.click(await screen.findByText('text'))
      if (type === FormTypeEnum.appSelector) {
        await user.click(screen.getAllByRole('button', { name: 'app.appSelector.placeholder' })[1]!)
        await user.click(await screen.findByRole('option', { name: /Support Bot/ }))
      }
      if (type === FormTypeEnum.modelSelector)
        await user.click(
          within(
            await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
          ).getByRole('button', { name: /^gpt-1/ }),
        )
      expect(onChange).toHaveBeenLastCalledWith({ selected: expected, dependent: 'reset' })
      if (type === FormTypeEnum.toolSelector) {
        await user.keyboard('{Escape}')
        await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
        expect(onChange).toHaveBeenLastCalledWith({ selected: null, dependent: 'reset' })
      }
    },
  )

  it('keeps existing model parameters when selecting another model', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Harness
        {...defaults}
        onChange={onChange}
        initialValue={{
          model: { completion_params: { temperature: 0.2 }, model: 'old', provider: 'openai' },
        }}
        formSchemas={[createTextSchema({ variable: 'model', type: FormTypeEnum.modelSelector })]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /old/ }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^gpt-1/ }),
    )
    expect(onChange).toHaveBeenLastCalledWith({
      model: {
        model: 'gpt-1',
        model_type: 'llm',
        provider: 'openai',
        mode: 'chat',
        completion_params: { temperature: 0.2 },
        type: FormTypeEnum.modelSelector,
      },
    })
  })

  it.each(['string&number', undefined])(
    'filters selectable variable types for scope %s',
    async (scope) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Harness
          {...defaults}
          onChange={onChange}
          formSchemas={[createTextSchema({ variable: 'variable', type: FormTypeEnum.any, scope })]}
        />,
      )
      await user.click(
        screen.getByRole('button', { name: /workflow.common.setVarValuePlaceholder/ }),
      )
      expect(screen.queryByText('enabled') !== null).toBe(scope === undefined)
      await user.click(await screen.findByText('count'))
      expect(onChange).toHaveBeenLastCalledWith({ variable: ['source', 'count'] })
    },
  )

  it('falls back to English labels, placeholders and explanatory text', async () => {
    const user = userEvent.setup()
    mockLanguageRef.value = 'fr_FR'
    render(
      <Harness
        {...defaults}
        initialValue={{ tools: null }}
        formSchemas={[
          createTextSchema({
            variable: 'key',
            label: createPartialI18n('API Key'),
            placeholder: createPartialI18n('Enter key'),
            tooltip: createPartialI18n('Use a private key'),
          }),
          createTextSchema({
            variable: 'tools',
            type: FormTypeEnum.multiToolSelector,
            label: createPartialI18n('Tools'),
            tooltip: createPartialI18n('Select tools to expose'),
          }),
        ]}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'API Key' })).toHaveAttribute(
      'placeholder',
      'Enter key',
    )
    await user.click(screen.getByRole('button', { name: 'API Key' }))
    expect(await screen.findByText('Use a private key')).toBeVisible()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Tools', expanded: false }))
    expect(await screen.findByText('Select tools to expose')).toBeVisible()
    expect(screen.getByText('plugin.detailPanel.toolSelector.empty')).toBeInTheDocument()
  })

  it('renders overrides, falls back for null or unmatched overrides, and supports custom schemas', () => {
    const schemas: Array<CredentialFormSchema | CustomSchema> = [
      createTextSchema({ variable: 'override', label: createI18n('Override') }),
      createTextSchema({
        variable: 'fallback',
        label: createI18n('Fallback'),
        placeholder: undefined,
      }),
      createTextSchema({
        variable: 'secret',
        type: FormTypeEnum.secretInput,
        label: createI18n('Secret'),
      }),
      { ...createBaseSchema(FormTypeEnum.textInput, { variable: 'custom' }), type: 'custom-type' },
    ]
    render(
      <Form<CustomSchema>
        {...defaults}
        value={{}}
        onChange={vi.fn()}
        formSchemas={schemas}
        override={[
          [FormTypeEnum.textInput],
          (schema) =>
            schema.variable === 'override' ? (
              <div key={schema.variable}>Custom override</div>
            ) : null,
        ]}
        customRenderField={(schema) => <div key={schema.variable}>Custom {schema.variable}</div>}
        fieldMoreInfo={(schema) => <span>Extra {schema.variable}</span>}
      />,
    )
    expect(screen.getByText('Custom override')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Fallback' })).toBeInTheDocument()
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'password')
    expect(screen.getByText('Custom custom')).toBeInTheDocument()
    expect(screen.getByText('Extra fallback')).toBeInTheDocument()
    expect(screen.getByText('Extra secret')).toBeInTheDocument()
  })
  it.each([
    [FormTypeEnum.textInput, undefined],
    [FormTypeEnum.radio, 'Option B'],
    [FormTypeEnum.select, undefined],
    [FormTypeEnum.modelSelector, 'plugin.detailPanel.configureModel'],
    [FormTypeEnum.toolSelector, 'plugin.detailPanel.configureTool'],
    [FormTypeEnum.multiToolSelector, 'plugin.detailPanel.toolSelector.title'],
    [FormTypeEnum.appSelector, 'app.appSelector.placeholder'],
    [FormTypeEnum.any, 'workflow.common.setVarValuePlaceholder'],
  ] as const)('shows validation feedback after a %s field changes', async (type, control) => {
    const user = userEvent.setup()
    const schema =
      type === FormTypeEnum.radio
        ? createRadioSchema({})
        : type === FormTypeEnum.select
          ? createSelectSchema({})
          : createTextSchema({ type })
    render(<Harness {...defaults} validating formSchemas={[schema]} />)
    expect(screen.queryByText('common.provider.validating')).not.toBeInTheDocument()
    if (type === FormTypeEnum.textInput) await user.type(screen.getByRole('textbox'), 'key')
    else if (type === FormTypeEnum.select) {
      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByRole('option', { name: 'Select B' }))
    } else
      await user.click(
        screen.getByRole(type === FormTypeEnum.radio ? 'radio' : 'button', {
          name: type === FormTypeEnum.any ? /workflow.common.setVarValuePlaceholder/ : control!,
        }),
      )
    if (type === FormTypeEnum.modelSelector)
      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
        ).getByRole('button', { name: /^gpt-1/ }),
      )
    if (type === FormTypeEnum.toolSelector || type === FormTypeEnum.multiToolSelector)
      await chooseTool(user, type === FormTypeEnum.multiToolSelector)
    if (type === FormTypeEnum.any) await user.click(await screen.findByText('text'))
    if (type === FormTypeEnum.appSelector) {
      await user.click(screen.getAllByRole('button', { name: 'app.appSelector.placeholder' })[1]!)
      await user.click(await screen.findByRole('option', { name: /Support Bot/ }))
    }
    expect(screen.getByText('common.provider.validating')).toBeInTheDocument()
  })
})
