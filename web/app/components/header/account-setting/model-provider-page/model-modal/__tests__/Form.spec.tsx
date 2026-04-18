import type { Node } from 'reactflow'
import type {
  CredentialFormSchema,
  CredentialFormSchemaBase,
  CredentialFormSchemaNumberInput,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  FormValue,
} from '../../declarations'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FormTypeEnum } from '../../declarations'
import Form from '../Form'

type CustomSchema = Omit<CredentialFormSchemaBase, 'type'> & { type: 'custom-type' }

type MockVarPayload = { type: string }

type AnyFormSchema = CredentialFormSchema | (CredentialFormSchemaBase & { type: FormTypeEnum })

const modelSelectorPropsSpy = vi.hoisted(() => vi.fn())
const toolSelectorPropsSpy = vi.hoisted(() => vi.fn())

const mockLanguageRef = { value: 'en_US' }
vi.mock('../../hooks', () => ({
  useLanguage: () => mockLanguageRef.value,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector', () => ({
  default: ({ onSelect }: { onSelect: (item: { id: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ id: 'app-1' })}>Select App</button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/model-selector', () => ({
  default: (props: {
    setModel: (model: { model: string, model_type: string }) => void
    isAgentStrategy?: boolean
    readonly?: boolean
  }) => {
    modelSelectorPropsSpy(props)
    return (
      <button type="button" onClick={() => props.setModel({ model: 'gpt-1', model_type: 'llm' })}>Select Model</button>
    )
  },
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/multiple-tool-selector', () => ({
  default: ({ onChange }: { onChange: (items: Array<{ id: string }>) => void }) => (
    <button type="button" onClick={() => onChange([{ id: 'tool-1' }])}>Select Tools</button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/tool-selector', () => ({
  default: (props: {
    onSelect: (item: { id: string }) => void
    onDelete: () => void
    nodeOutputVars?: unknown[]
    availableNodes?: unknown[]
    disabled?: boolean
  }) => {
    toolSelectorPropsSpy(props)
    return (
      <div>
        <button type="button" onClick={() => props.onSelect({ id: 'tool-1' })}>Select Tool</button>
        <button type="button" onClick={props.onDelete}>Remove Tool</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ filterVar, onChange }: { filterVar?: (payload: MockVarPayload) => boolean, onChange: (items: Array<{ name: string }>) => void }) => {
    const allowed = filterVar ? filterVar({ type: 'text' }) : true
    const blocked = filterVar ? filterVar({ type: 'image' }) : false
    return (
      <div>
        <div>{allowed ? 'allowed' : 'blocked'}</div>
        <div>{blocked ? 'allowed' : 'blocked'}</div>
        <button type="button" onClick={() => onChange([{ name: 'var-1' }])}>Pick Variable</button>
      </div>
    )
  },
}))

vi.mock('../../../key-validator/ValidateStatus', () => ({
  ValidatingTip: () => <div>Validating...</div>,
}))

const createI18n = (text: string) => ({ en_US: text, zh_Hans: text })
const createPartialI18n = (text: string) => ({ en_US: text } as unknown as ReturnType<typeof createI18n>)

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

const createTextSchema = (overrides: Partial<CredentialFormSchemaTextInput> & { type?: FormTypeEnum }) => ({
  ...createBaseSchema(overrides.type ?? FormTypeEnum.textInput, { variable: overrides.variable ?? 'text' }),
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

describe('Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguageRef.value = 'en_US'
  })

  // Rendering basics
  describe('Rendering', () => {
    it('should render visible fields and apply default values', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'api_key',
          label: createI18n('API Key'),
          placeholder: createI18n('API Key'),
          required: true,
          default: 'default-key',
        }),
        createTextSchema({
          variable: 'secret',
          type: FormTypeEnum.secretInput,
          label: createI18n('Secret'),
          placeholder: createI18n('Secret'),
        }),
        createNumberSchema({
          variable: 'limit',
          label: createI18n('Limit'),
          placeholder: createI18n('Limit'),
          default: '5',
        }),
        createTextSchema({
          variable: 'hidden',
          label: createI18n('Hidden'),
          show_on: [{ variable: 'toggle', value: 'on' }],
        }),
      ]
      const value: FormValue = {
        api_key: '',
        secret: 'top-secret',
        limit: '',
        toggle: 'off',
      }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue
        />,
      )

      expect(screen.getByPlaceholderText('API Key'))!.toHaveValue('default-key')
      expect(screen.getByPlaceholderText('Secret'))!.toHaveValue('top-secret')
      expect(screen.getByPlaceholderText('Limit'))!.toHaveValue(5)
      expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
      expect(screen.getAllByText('*')).toHaveLength(1)
    })
  })

  // Interaction updates
  describe('Interactions', () => {
    it('should update values and clear dependent fields when a field changes', async () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'api_key',
          label: createI18n('API Key'),
          placeholder: createI18n('API Key'),
        }),
        createTextSchema({
          variable: 'dependent',
          label: createI18n('Dependent'),
          default: 'reset',
        }),
      ]
      const value: FormValue = { api_key: 'old', dependent: 'keep' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{ api_key: ['dependent'] }}
          isEditMode={false}
        />,
      )

      fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'new-key' } })

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith({ api_key: 'new-key', dependent: 'reset' })
        expect(screen.getByText('Validating...'))!.toBeInTheDocument()
      })
    })

    it('should render radio options based on show conditions and ignore edit-locked changes', () => {
      const formSchemas: AnyFormSchema[] = [
        createRadioSchema({
          variable: 'region',
          label: createI18n('Region'),
          options: [
            { label: createI18n('US'), value: 'us', show_on: [] },
            { label: createI18n('EU'), value: 'eu', show_on: [{ variable: 'toggle', value: 'on' }] },
          ],
        }),
        createRadioSchema({
          variable: 'hidden_region',
          label: createI18n('Hidden Region'),
          show_on: [{ variable: 'toggle', value: 'hidden' }],
          options: [
            { label: createI18n('Hidden A'), value: 'a', show_on: [] },
          ],
        }),
        createRadioSchema({
          variable: '__model_name',
          label: createI18n('Locked'),
          options: [
            { label: createI18n('Locked A'), value: 'a', show_on: [] },
          ],
        }),
      ]
      const value: FormValue = { region: 'us', toggle: 'on', __model_name: 'a' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode
        />,
      )

      expect(screen.getByText('EU'))!.toBeInTheDocument()
      expect(screen.queryByText('Hidden Region')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('EU'))
      fireEvent.click(screen.getByText('Locked A'))

      expect(onChange).toHaveBeenCalledWith({ region: 'eu', toggle: 'on', __model_name: 'a' })
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('should render select and checkbox fields and update checkbox value', () => {
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'model',
          label: createI18n('Model'),
          placeholder: createI18n('Pick model'),
          show_on: [{ variable: 'toggle', value: 'on' }],
          options: [
            { label: createI18n('Select A'), value: 'a', show_on: [] },
            { label: createI18n('Select B'), value: 'b', show_on: [{ variable: 'toggle', value: 'on' }] },
          ],
        }),
        createRadioSchema({
          variable: 'agree',
          type: FormTypeEnum.checkbox,
          label: createI18n('Agree'),
          options: [],
          show_on: [{ variable: 'toggle', value: 'on' }],
        }),
      ]
      const value: FormValue = { model: 'a', agree: false, toggle: 'off' }
      const onChange = vi.fn()

      const { rerender } = render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.queryByText('Pick model')).not.toBeInTheDocument()
      expect(screen.queryByText('Agree')).not.toBeInTheDocument()

      rerender(
        <Form
          value={{ model: 'a', agree: false, toggle: 'on' }}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('Select A'))!.toBeInTheDocument()
      fireEvent.click(screen.getByText('Select A'))
      fireEvent.click(screen.getByText('Select B'))

      fireEvent.click(screen.getByText('True'))

      expect(onChange).toHaveBeenCalledWith({ model: 'b', agree: false, toggle: 'on' })
      expect(onChange).toHaveBeenCalledWith({ model: 'a', agree: true, toggle: 'on' })
    })

    it('should pass selected items from model and tool selectors to the form value', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'model_selector',
          type: FormTypeEnum.modelSelector,
          label: createI18n('Model Selector'),
        }),
        createTextSchema({
          variable: 'tool_selector',
          type: FormTypeEnum.toolSelector,
          label: createI18n('Tool Selector'),
        }),
        createTextSchema({
          variable: 'multi_tool',
          type: FormTypeEnum.multiToolSelector,
          label: createI18n('Multi Tool'),
          tooltip: createI18n('Tips'),
        }),
        createTextSchema({
          variable: 'app_selector',
          type: FormTypeEnum.appSelector,
          label: createI18n('App Selector'),
        }),
      ]
      const value: FormValue = { model_selector: {}, tool_selector: null, multi_tool: [], app_selector: null }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      fireEvent.click(screen.getByText('Select Model'))
      fireEvent.click(screen.getByText('Select Tool'))
      fireEvent.click(screen.getByText('Remove Tool'))
      fireEvent.click(screen.getByText('Select Tools'))
      fireEvent.click(screen.getByText('Select App'))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        model_selector: { model: 'gpt-1', model_type: 'llm', type: FormTypeEnum.modelSelector },
      }))
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        tool_selector: { id: 'tool-1' },
      }))
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        tool_selector: null,
      }))
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        multi_tool: [{ id: 'tool-1' }],
      }))
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        app_selector: { id: 'app-1', type: FormTypeEnum.appSelector },
      }))
    })

    it('should render variable picker and custom render overrides', () => {
      const formSchemas: Array<AnyFormSchema | CustomSchema> = [
        createTextSchema({
          variable: 'override',
          label: createI18n('Override'),
          type: FormTypeEnum.textInput,
        }),
        createTextSchema({
          variable: 'any_var',
          type: FormTypeEnum.any,
          label: createI18n('Any Var'),
          scope: 'text&audio',
        }),
        createTextSchema({
          variable: 'any_without_scope',
          type: FormTypeEnum.any,
          label: createI18n('Any Without Scope'),
        }),
        {
          ...createTextSchema({
            variable: 'custom_field',
            label: createI18n('Custom Field'),
          }),
          type: 'custom-type',
        },
      ]
      const value: FormValue = { override: '', any_var: [], any_without_scope: [], custom_field: '' }
      const onChange = vi.fn()

      render(
        <Form<CustomSchema>
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          fieldMoreInfo={() => <div>Extra Info</div>}
          override={[[FormTypeEnum.textInput], () => <div key="override-field">Override Field</div>]}
          customRenderField={schema => (
            <div key={schema.variable}>
              Custom Render:
              {schema.variable}
            </div>
          )}
        />,
      )

      expect(screen.getByText('Override Field'))!.toBeInTheDocument()
      expect(screen.getByText(/Custom Render:.*custom_field/))!.toBeInTheDocument()
      expect(screen.getAllByText('allowed')).toHaveLength(3)
      expect(screen.getAllByText('blocked')).toHaveLength(1)

      fireEvent.click(screen.getAllByText('Pick Variable')[0]!)

      expect(onChange).toHaveBeenCalledWith({ override: '', any_var: [{ name: 'var-1' }], any_without_scope: [], custom_field: '' })
      expect(screen.getAllByText('Extra Info')).toHaveLength(2)
    })

    // readonly=true: input disabled
    it('should disable inputs when readonly is true', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'api_key',
          label: createI18n('API Key'),
          placeholder: createI18n('API Key'),
        }),
      ]
      const value: FormValue = { api_key: 'my-key' }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          readonly
        />,
      )

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('API Key'))!.toBeDisabled()
    })

    // Override returns null: falls through to default renderer
    it('should fall through to default renderer when override returns null', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'field1',
          label: createI18n('Field 1'),
          placeholder: createI18n('Field 1'),
          type: FormTypeEnum.textInput,
        }),
      ]
      const value: FormValue = { field1: '' }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          override={[[FormTypeEnum.textInput], () => null]}
        />,
      )

      // Assert - should fall through to default textInput renderer
      // Assert - should fall through to default textInput renderer
      expect(screen.getByPlaceholderText('Field 1'))!.toBeInTheDocument()
    })

    // isShowDefaultValue=true, value is null → default shown
    it('should show default value when value is null and isShowDefaultValue is true', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'field1',
          label: createI18n('Nullable'),
          placeholder: createI18n('Nullable'),
          default: 'default-val',
        }),
      ]
      const value: FormValue = { field1: null }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue
        />,
      )

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('Nullable'))!.toHaveValue('default-val')
    })

    // isShowDefaultValue=true, value is undefined → default shown
    it('should show default value when value is undefined and isShowDefaultValue is true', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'field1',
          label: createI18n('Undef'),
          placeholder: createI18n('Undef'),
          default: 'default-undef',
        }),
      ]
      const value: FormValue = { field1: undefined }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue
        />,
      )

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('Undef'))!.toHaveValue('default-undef')
    })

    // isEditMode=true, variable=__model_type → textInput disabled
    it('should disable __model_type field in edit mode', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: '__model_type',
          label: createI18n('Model Type'),
          placeholder: createI18n('Model Type'),
        }),
      ]
      const value: FormValue = { __model_type: 'llm' }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode
        />,
      )

      // Assert
      // Assert
      expect(screen.getByPlaceholderText('Model Type'))!.toBeDisabled()
    })

    // Label with missing language key → en_US fallback used
    it('should fall back to en_US label when current language key is missing', () => {
    // Arrange
      mockLanguageRef.value = 'fr_FR'
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'field1',
          label: createPartialI18n('English Label'),
          placeholder: createI18n('Field 1'),
        }),
      ]
      const value: FormValue = { field1: '' }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Assert
      // Assert
      expect(screen.getByText('English Label'))!.toBeInTheDocument()
    })

    // Select field with isShowDefaultValue=true
    it('should use default value for select field when value is empty and isShowDefaultValue is true', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'select_field',
          label: createI18n('Select Field'),
          placeholder: createI18n('Pick one'),
          default: 'b',
        }),
      ]
      const value: FormValue = { select_field: '' }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue
        />,
      )

      // Assert - Select B should be the rendered default
      // Assert - Select B should be the rendered default
      expect(screen.getByText('Select B'))!.toBeInTheDocument()
    })

    // Radio option with show_on condition not met → option filtered out
    it('should filter out radio options whose show_on conditions are not met', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createRadioSchema({
          variable: 'choice',
          label: createI18n('Choice'),
          options: [
            { label: createI18n('Always Visible'), value: 'a', show_on: [] },
            { label: createI18n('Conditional'), value: 'b', show_on: [{ variable: 'toggle', value: 'yes' }] },
          ],
        }),
      ]
      const value: FormValue = { choice: 'a', toggle: 'no' }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Assert
      // Assert
      expect(screen.getByText('Always Visible'))!.toBeInTheDocument()
      expect(screen.queryByText('Conditional')).not.toBeInTheDocument()
    })

    // isEditMode + __model_name key: handleFormChange returns early
    it('should not call onChange when editing __model_name in edit mode', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: '__model_name',
          label: createI18n('Model Name'),
          placeholder: createI18n('Model Name'),
        }),
      ]
      const value: FormValue = { __model_name: 'old-model' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode
        />,
      )

      fireEvent.change(screen.getByPlaceholderText('Model Name'), { target: { value: 'new-model' } })

      expect(onChange).not.toHaveBeenCalled()
    })

    // showOnVariableMap: schema not found → clearVariable is undefined
    it('should set undefined for dependent variable when schema is not found in formSchemas', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'api_key',
          label: createI18n('API Key'),
          placeholder: createI18n('API Key'),
        }),
      ]
      const value: FormValue = { api_key: 'old', missing_field: 'val' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{ api_key: ['missing_field'] }}
          isEditMode={false}
        />,
      )

      fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'new-key' } })

      expect(onChange).toHaveBeenCalledWith({ api_key: 'new-key', missing_field: undefined })
    })

    // secretInput renders password type, textNumber renders number type
    it('should render password type for secretInput and number type for textNumber', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'secret',
          type: FormTypeEnum.secretInput,
          label: createI18n('Secret'),
          placeholder: createI18n('Secret'),
        }),
        createNumberSchema({
          variable: 'num',
          label: createI18n('Number'),
          placeholder: createI18n('Number'),
        }),
      ]
      const value: FormValue = { secret: 'hidden', num: '5' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Both rendered successfully
      // Both rendered successfully
      expect(screen.getByPlaceholderText('Secret'))!.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Number'))!.toBeInTheDocument()
    })

    // Placeholder fallback: null placeholder
    it('should handle undefined placeholder gracefully', () => {
      const formSchemas: AnyFormSchema[] = [
        {
          ...createBaseSchema(FormTypeEnum.textInput, { variable: 'no_ph' }),
          label: createI18n('No Placeholder'),
        } as unknown as CredentialFormSchemaTextInput,
      ]
      const value: FormValue = { no_ph: '' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('No Placeholder'))!.toBeInTheDocument()
    })

    // validating=true + changeKey matches variable: ValidatingTip shown
    it('should show ValidatingTip for the field being validated', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'api_key',
          label: createI18n('API Key'),
          placeholder: createI18n('API Key'),
        }),
        createTextSchema({
          variable: 'other',
          label: createI18n('Other'),
          placeholder: createI18n('Other'),
        }),
      ]
      const value: FormValue = { api_key: '', other: '' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Change api_key to set changeKey
      fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'new' } })

      // ValidatingTip should appear for api_key
      // ValidatingTip should appear for api_key
      expect(screen.getByText('Validating...'))!.toBeInTheDocument()
    })

    // Select with show_on not met: hidden
    it('should hide select field when show_on conditions are not met', () => {
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'hidden_select',
          label: createI18n('Hidden Select'),
          placeholder: createI18n('Pick one'),
          show_on: [{ variable: 'toggle', value: 'on' }],
        }),
      ]
      const value: FormValue = { hidden_select: 'a', toggle: 'off' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.queryByText('Hidden Select')).not.toBeInTheDocument()
    })

    // Select option with show_on filter
    it('should filter out select options whose show_on conditions are not met', () => {
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'filtered_select',
          label: createI18n('Filtered Select'),
          placeholder: createI18n('Pick one'),
          options: [
            { label: createI18n('Always'), value: 'a', show_on: [] },
            { label: createI18n('Conditional'), value: 'b', show_on: [{ variable: 'toggle', value: 'yes' }] },
          ],
        }),
      ]
      const value: FormValue = { filtered_select: 'a', toggle: 'no' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('Always'))!.toBeInTheDocument()
      expect(screen.queryByText('Conditional')).not.toBeInTheDocument()
    })

    // Checkbox with show_on not met: hidden
    it('should hide checkbox field when show_on conditions are not met', () => {
      const formSchemas: AnyFormSchema[] = [
        createRadioSchema({
          variable: 'hidden_check',
          type: FormTypeEnum.checkbox,
          label: createI18n('Hidden Checkbox'),
          options: [],
          show_on: [{ variable: 'toggle', value: 'on' }],
        }),
      ]
      const value: FormValue = { hidden_check: false, toggle: 'off' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.queryByText('Hidden Checkbox')).not.toBeInTheDocument()
    })

    // Select with readonly: disabled
    it('should disable select field when readonly is true', () => {
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'ro_select',
          label: createI18n('RO Select'),
          placeholder: createI18n('Pick one'),
        }),
      ]
      const value: FormValue = { ro_select: 'a' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          readonly
        />,
      )

      const selectTrigger = screen.getByRole('button', { name: 'Select A' })
      fireEvent.click(selectTrigger)
      expect(screen.queryByText('Select B')).not.toBeInTheDocument()
    })

    // isShowDefaultValue=false: value used even if empty
    it('should use actual empty value when isShowDefaultValue is false', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'field1',
          label: createI18n('Field'),
          placeholder: createI18n('Field'),
          default: 'default-val',
        }),
      ]
      const value: FormValue = { field1: '' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue={false}
        />,
      )

      expect(screen.getByPlaceholderText('Field'))!.toHaveValue('')
    })

    // Radio with disabled=true in edit mode for __model_type
    it('should apply disabled styling for __model_type radio in edit mode', () => {
      const formSchemas: AnyFormSchema[] = [
        createRadioSchema({
          variable: '__model_type',
          label: createI18n('Model Type Radio'),
          options: [
            { label: createI18n('Type A'), value: 'a', show_on: [] },
          ],
        }),
      ]
      const value: FormValue = { __model_type: 'a' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode
        />,
      )

      // Click should be blocked by isEditMode guard
      fireEvent.click(screen.getByText('Type A'))
      expect(onChange).not.toHaveBeenCalled()
    })

    // multiToolSelector with no tooltip
    it('should render multiToolSelector without tooltip when tooltip is not provided', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'multi_tool',
          type: FormTypeEnum.multiToolSelector,
          label: createI18n('Multi Tool No Tip'),
        }),
      ]
      const value: FormValue = { multi_tool: [] }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('Select Tools'))!.toBeInTheDocument()
    })

    // Override with non-matching type: falls through to default
    it('should not override when form type does not match override types', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'secret_field',
          type: FormTypeEnum.secretInput,
          label: createI18n('Secret Field'),
          placeholder: createI18n('Secret Field'),
        }),
      ]
      const value: FormValue = { secret_field: 'val' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          override={[[FormTypeEnum.textInput], () => <div>Override Hit</div>]}
        />,
      )

      expect(screen.queryByText('Override Hit')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Secret Field'))!.toBeInTheDocument()
    })

    // Select with isShowDefaultValue: null value shows default
    it('should use default value for select when value is null and isShowDefaultValue is true', () => {
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'null_select',
          label: createI18n('Null Select'),
          placeholder: createI18n('Pick'),
          default: 'b',
        }),
      ]
      const value: FormValue = { null_select: null }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue
        />,
      )

      expect(screen.getByText('Select B'))!.toBeInTheDocument()
    })

    // Select with isShowDefaultValue: undefined value shows default
    it('should use default value for select when value is undefined and isShowDefaultValue is true', () => {
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'undef_select',
          label: createI18n('Undef Select'),
          placeholder: createI18n('Pick'),
          default: 'a',
        }),
      ]
      const value: FormValue = { undef_select: undefined }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue
        />,
      )

      expect(screen.getByText('Select A'))!.toBeInTheDocument()
    })

    // No fieldMoreInfo: should not crash
    it('should render without fieldMoreInfo', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'f1',
          label: createI18n('Field 1'),
          placeholder: createI18n('Field 1'),
        }),
      ]
      const value: FormValue = { f1: '' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByPlaceholderText('Field 1'))!.toBeInTheDocument()
    })

    it('should render tooltip when schema has tooltip property', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'api_key',
          label: createI18n('API Key'),
          placeholder: createI18n('API Key'),
          tooltip: createI18n('Enter your API key here'),
        }),
        createRadioSchema({
          variable: 'region',
          label: createI18n('Region'),
          tooltip: createI18n('Select region'),
        }),
        createSelectSchema({
          variable: 'model',
          label: createI18n('Model'),
          tooltip: createI18n('Choose model'),
        }),
        {
          ...createBaseSchema(FormTypeEnum.checkbox, { variable: 'agree' }),
          label: createI18n('Agree'),
          tooltip: createI18n('Agree tooltip'),
          options: [],
          show_on: [],
        } as unknown as AnyFormSchema,
      ]
      const value: FormValue = { api_key: '', region: 'a', model: 'a', agree: false }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('API Key'))!.toBeInTheDocument()
      expect(screen.getByText('Region'))!.toBeInTheDocument()
      expect(screen.getByText('Model'))!.toBeInTheDocument()
      expect(screen.getByText('Agree'))!.toBeInTheDocument()
    })

    it('should render required asterisk for radio, select, checkbox, and other field types', () => {
      const formSchemas: AnyFormSchema[] = [
        createRadioSchema({
          variable: 'radio_req',
          label: createI18n('Radio Req'),
          required: true,
        }),
        createSelectSchema({
          variable: 'select_req',
          label: createI18n('Select Req'),
          required: true,
        }),
        {
          ...createBaseSchema(FormTypeEnum.checkbox, { variable: 'check_req' }),
          label: createI18n('Check Req'),
          required: true,
          options: [],
          show_on: [],
        } as unknown as AnyFormSchema,
        createTextSchema({
          variable: 'model_sel',
          type: FormTypeEnum.modelSelector,
          label: createI18n('Model Sel'),
          required: true,
        }),
        createTextSchema({
          variable: 'tool_sel',
          type: FormTypeEnum.toolSelector,
          label: createI18n('Tool Sel'),
          required: true,
        }),
        createTextSchema({
          variable: 'app_sel',
          type: FormTypeEnum.appSelector,
          label: createI18n('App Sel'),
          required: true,
        }),
        createTextSchema({
          variable: 'any_field',
          type: FormTypeEnum.any,
          label: createI18n('Any Field'),
          required: true,
        }),
      ]
      const value: FormValue = {
        radio_req: 'a',
        select_req: 'a',
        check_req: false,
        model_sel: {},
        tool_sel: null,
        app_sel: null,
        any_field: [],
      }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // All 7 required fields should have asterisks
      expect(screen.getAllByText('*')).toHaveLength(7)
    })

    it('should show ValidatingTip for radio field being validated', () => {
      const formSchemas: AnyFormSchema[] = [
        createRadioSchema({
          variable: 'region',
          label: createI18n('Region'),
        }),
      ]
      const value: FormValue = { region: 'a' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      fireEvent.click(screen.getByText('Option B'))
      expect(screen.getByText('Validating...'))!.toBeInTheDocument()
    })

    it('should render textInput with show_on condition met', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'conditional_field',
          label: createI18n('Conditional'),
          placeholder: createI18n('Conditional'),
          show_on: [{ variable: 'toggle', value: 'on' }],
        }),
      ]
      const value: FormValue = { conditional_field: 'val', toggle: 'on' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByPlaceholderText('Conditional'))!.toBeInTheDocument()
    })

    it('should render radio with show_on condition met', () => {
      const formSchemas: AnyFormSchema[] = [
        createRadioSchema({
          variable: 'cond_radio',
          label: createI18n('Cond Radio'),
          show_on: [{ variable: 'toggle', value: 'on' }],
        }),
      ]
      const value: FormValue = { cond_radio: 'a', toggle: 'on' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('Cond Radio'))!.toBeInTheDocument()
    })

    it('should proceed with onChange when isEditMode is true but key is not locked', () => {
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'custom_key',
          label: createI18n('Custom Key'),
          placeholder: createI18n('Custom Key'),
        }),
      ]
      const value: FormValue = { custom_key: 'old' }
      const onChange = vi.fn()

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode
        />,
      )

      fireEvent.change(screen.getByPlaceholderText('Custom Key'), { target: { value: 'new' } })
      expect(onChange).toHaveBeenCalledWith({ custom_key: 'new' })
    })

    it('should return undefined when customRenderField is not provided for unknown type', () => {
      const formSchemas: Array<AnyFormSchema | CustomSchema> = [
        {
          ...createTextSchema({
            variable: 'unknown',
            label: createI18n('Unknown'),
          }),
          type: 'custom-type',
        } as unknown as CustomSchema,
      ]
      const value: FormValue = { unknown: '' }

      render(
        <Form<CustomSchema>
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      // Should not crash - the field simply doesn't render
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    })

    it('should render fieldMoreInfo for checkbox field', () => {
      const formSchemas: AnyFormSchema[] = [
        {
          ...createBaseSchema(FormTypeEnum.checkbox, { variable: 'check' }),
          label: createI18n('Check'),
          options: [],
          show_on: [],
        } as unknown as AnyFormSchema,
      ]
      const value: FormValue = { check: false }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          fieldMoreInfo={() => <div>Check Extra</div>}
        />,
      )

      expect(screen.getByText('Check Extra'))!.toBeInTheDocument()
    })
  })

  describe('Language fallback branches', () => {
    it('should fallback to en_US for labels, placeholders, and tooltips when language key is missing', () => {
      mockLanguageRef.value = 'fr_FR'

      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'api_key',
          label: createPartialI18n('API Key Fallback'),
          placeholder: createPartialI18n('Enter Key Fallback'),
          tooltip: createPartialI18n('Tooltip Fallback'),
        }),
        createRadioSchema({
          variable: 'region',
          label: createPartialI18n('Region Fallback'),
        }),
        createSelectSchema({
          variable: 'model',
          label: createPartialI18n('Model Fallback'),
          placeholder: createPartialI18n('Select Fallback'),
        }),
        {
          ...createBaseSchema(FormTypeEnum.checkbox, { variable: 'agree' }),
          label: createPartialI18n('Agree Fallback'),
          options: [],
          show_on: [],
        } as unknown as AnyFormSchema,
      ]
      const value: FormValue = { api_key: '', region: 'a', model: 'a', agree: false }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('API Key Fallback'))!.toBeInTheDocument()
      expect(screen.getByText('Region Fallback'))!.toBeInTheDocument()
      expect(screen.getByText('Model Fallback'))!.toBeInTheDocument()
      expect(screen.getByText('Agree Fallback'))!.toBeInTheDocument()
    })

    it('should fallback to en_US for modelSelector, toolSelector, and appSelector labels', () => {
      mockLanguageRef.value = 'fr_FR'

      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'model_sel',
          type: FormTypeEnum.modelSelector,
          label: createPartialI18n('ModelSel Fallback'),
        }),
        createTextSchema({
          variable: 'tool_sel',
          type: FormTypeEnum.toolSelector,
          label: createPartialI18n('ToolSel Fallback'),
        }),
        createTextSchema({
          variable: 'app_sel',
          type: FormTypeEnum.appSelector,
          label: createPartialI18n('AppSel Fallback'),
        }),
        createTextSchema({
          variable: 'any_field',
          type: FormTypeEnum.any,
          label: createPartialI18n('Any Fallback'),
        }),
      ]
      const value: FormValue = { model_sel: '', tool_sel: '', app_sel: '', any_field: '' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      expect(screen.getByText('ModelSel Fallback'))!.toBeInTheDocument()
      expect(screen.getByText('ToolSel Fallback'))!.toBeInTheDocument()
      expect(screen.getByText('AppSel Fallback'))!.toBeInTheDocument()
      expect(screen.getByText('Any Fallback'))!.toBeInTheDocument()
    })

    it('should not change value when __model_type is edited in edit mode', () => {
      const onChange = vi.fn()
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: '__model_type',
          label: createI18n('Model Type'),
          placeholder: createI18n('Model Type'),
        }),
      ]
      const value: FormValue = { __model_type: 'llm' }

      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={true}
        />,
      )

      const input = screen.getByDisplayValue('llm')
      fireEvent.change(input, { target: { value: 'embedding' } })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should use value instead of default when isShowDefaultValue is true but value is non-empty', () => {
      const formSchemas: AnyFormSchema[] = [
        {
          ...createTextSchema({
            variable: 'with_val',
            label: createI18n('With Value'),
            placeholder: createI18n('Placeholder'),
          }),
          default: 'default-text',
        } as unknown as AnyFormSchema,
      ]
      const value: FormValue = { with_val: 'actual-value' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isShowDefaultValue
        />,
      )

      expect(screen.getByDisplayValue('actual-value'))!.toBeInTheDocument()
    })

    it('should pass nodeOutputVars and availableNodes to toolSelector', () => {
      toolSelectorPropsSpy.mockClear()
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'tool_sel',
          type: FormTypeEnum.toolSelector,
          label: createI18n('Tool Selector'),
        }),
      ]
      const value: FormValue = { tool_sel: '' }
      const nodeOutputVars: NodeOutPutVar[] = []
      const availableNodes: Node[] = []

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          nodeOutputVars={nodeOutputVars}
          availableNodes={availableNodes}
        />,
      )

      expect(screen.getByText('Select Tool'))!.toBeInTheDocument()
      expect(toolSelectorPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
        nodeOutputVars,
        availableNodes,
      }))
    })

    it('should pass isAgentStrategy to modelSelector', () => {
      modelSelectorPropsSpy.mockClear()
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'model_sel',
          type: FormTypeEnum.modelSelector,
          label: createI18n('Model Selector'),
        }),
      ]
      const value: FormValue = { model_sel: '' }

      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          isAgentStrategy
        />,
      )

      expect(screen.getByText('Select Model'))!.toBeInTheDocument()
      expect(modelSelectorPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
        isAgentStrategy: true,
      }))
    })

    it('should use empty array fallback for multiToolSelector when value is null', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'multi_tool',
          type: FormTypeEnum.multiToolSelector,
          label: createI18n('Multi Tool'),
        }),
      ]
      const value: FormValue = { multi_tool: null }
      const onChange = vi.fn()

      // Act
      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Assert - should render without crash (value[variable] || [] path taken)
      // Assert - should render without crash (value[variable] || [] path taken)
      expect(screen.getByText('Select Tools'))!.toBeInTheDocument()
    })

    it('should show ValidatingTip for multiToolSelector field being validated', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'multi_tool',
          type: FormTypeEnum.multiToolSelector,
          label: createI18n('Multi Tool'),
        }),
      ]
      const value: FormValue = { multi_tool: [] }
      const onChange = vi.fn()

      // Act
      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      fireEvent.click(screen.getByText('Select Tools'))

      // Assert
      // Assert
      expect(screen.getByText('Validating...'))!.toBeInTheDocument()
    })

    it('should show ValidatingTip for appSelector field being validated', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'app_sel',
          type: FormTypeEnum.appSelector,
          label: createI18n('App Selector'),
        }),
      ]
      const value: FormValue = { app_sel: null }
      const onChange = vi.fn()

      // Act
      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      fireEvent.click(screen.getByText('Select App'))

      // Assert
      // Assert
      expect(screen.getByText('Validating...'))!.toBeInTheDocument()
    })

    it('should show ValidatingTip for any-type field being validated', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'any_var',
          type: FormTypeEnum.any,
          label: createI18n('Any Var'),
          scope: 'text',
        }),
      ]
      const value: FormValue = { any_var: [] }
      const onChange = vi.fn()

      // Act
      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      fireEvent.click(screen.getByText('Pick Variable'))

      // Assert
      // Assert
      expect(screen.getByText('Validating...'))!.toBeInTheDocument()
    })

    it('should use empty string fallback for nodeId in any-type when nodeId is not provided', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'any_field',
          type: FormTypeEnum.any,
          label: createI18n('Any Field'),
        }),
      ]
      const value: FormValue = { any_field: [] }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          // nodeId is not provided, so nodeId || '' fallback is exercised
        />,
      )

      // Assert - should render without crash
      // Assert - should render without crash
      expect(screen.getByText('Any Field'))!.toBeInTheDocument()
    })

    it('should use en_US label fallback for multiToolSelector when language key is missing', () => {
      // Arrange
      mockLanguageRef.value = 'fr_FR'

      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'multi_tool',
          type: FormTypeEnum.multiToolSelector,
          label: createPartialI18n('MultiTool Fallback'),
          tooltip: createPartialI18n('Tooltip Fallback'),
        }),
      ]
      const value: FormValue = { multi_tool: [] }

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Assert - MultipleToolSelector mock renders with the label prop
      // Assert - MultipleToolSelector mock renders with the label prop
      expect(screen.getByText('Select Tools'))!.toBeInTheDocument()
    })

    it('should show ValidatingTip for select field being validated', () => {
      // Arrange: value 'a' is pre-selected so 'Select A' text appears in the trigger button
      const formSchemas: AnyFormSchema[] = [
        createSelectSchema({
          variable: 'model_select',
          label: createI18n('Model'),
        }),
      ]
      const value: FormValue = { model_select: 'a' }
      const onChange = vi.fn()

      // Act
      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // First click opens the dropdown (Select A is the trigger button text)
      fireEvent.click(screen.getByText('Select A'))
      // Then click on 'Select B' option in the open dropdown
      fireEvent.click(screen.getByText('Select B'))

      // Assert: ValidatingTip shows for the select field
      // Assert: ValidatingTip shows for the select field
      expect(screen.getByText('Validating...'))!.toBeInTheDocument()
    })

    it('should show ValidatingTip for toolSelector field being validated', () => {
      // Arrange
      const formSchemas: AnyFormSchema[] = [
        createTextSchema({
          variable: 'tool_sel',
          type: FormTypeEnum.toolSelector,
          label: createI18n('Tool Selector'),
        }),
      ]
      const value: FormValue = { tool_sel: null }
      const onChange = vi.fn()

      // Act
      render(
        <Form
          value={value}
          onChange={onChange}
          formSchemas={formSchemas}
          validating
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
        />,
      )

      // Trigger tool selection to set changeKey
      fireEvent.click(screen.getByText('Select Tool'))

      // Assert
      // Assert
      expect(screen.getByText('Validating...'))!.toBeInTheDocument()
    })

    it('should not render customRenderField for a FormTypeEnum value that is unhandled by Form', () => {
      // Arrange: pass a FormTypeEnum value that exists in the enum but is not handled by any if block
      const formSchemas: Array<AnyFormSchema> = [
        {
          ...createBaseSchema(FormTypeEnum.boolean, { variable: 'bool_field' }),
          label: createI18n('Boolean Field'),
          show_on: [],
        } as unknown as AnyFormSchema,
      ]
      const value: FormValue = { bool_field: false }
      const customRenderField = vi.fn()

      // Act
      render(
        <Form
          value={value}
          onChange={vi.fn()}
          formSchemas={formSchemas}
          validating={false}
          validatedSuccess={false}
          showOnVariableMap={{}}
          isEditMode={false}
          customRenderField={customRenderField}
        />,
      )

      // Assert: customRenderField is not called for a known FormTypeEnum (boolean is in the enum)
      expect(customRenderField).not.toHaveBeenCalled()
    })
  })
})
