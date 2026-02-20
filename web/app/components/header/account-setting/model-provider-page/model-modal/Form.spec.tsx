import type {
  CredentialFormSchema,
  CredentialFormSchemaBase,
  CredentialFormSchemaNumberInput,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  FormValue,
} from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { FormTypeEnum } from '../declarations'
import Form from './Form'

type CustomSchema = Omit<CredentialFormSchemaBase, 'type'> & { type: 'custom-type' }

type MockVarPayload = { type: string }

type AnyFormSchema = CredentialFormSchema | (CredentialFormSchemaBase & { type: FormTypeEnum })

vi.mock('../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector', () => ({
  default: ({ onSelect }: { onSelect: (item: { id: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ id: 'app-1' })}>Select App</button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/model-selector', () => ({
  default: ({ setModel }: { setModel: (model: { model: string, model_type: string }) => void }) => (
    <button type="button" onClick={() => setModel({ model: 'gpt-1', model_type: 'llm' })}>Select Model</button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/multiple-tool-selector', () => ({
  default: ({ onChange }: { onChange: (items: Array<{ id: string }>) => void }) => (
    <button type="button" onClick={() => onChange([{ id: 'tool-1' }])}>Select Tools</button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/tool-selector', () => ({
  default: ({ onSelect, onDelete }: { onSelect: (item: { id: string }) => void, onDelete: () => void }) => (
    <div>
      <button type="button" onClick={() => onSelect({ id: 'tool-1' })}>Select Tool</button>
      <button type="button" onClick={onDelete}>Remove Tool</button>
    </div>
  ),
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

vi.mock('../../key-validator/ValidateStatus', () => ({
  ValidatingTip: () => <div>Validating...</div>,
}))

const createI18n = (text: string) => ({ en_US: text, zh_Hans: text })

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

      expect(screen.getByPlaceholderText('API Key')).toHaveValue('default-key')
      expect(screen.getByPlaceholderText('Secret')).toHaveValue('top-secret')
      expect(screen.getByPlaceholderText('Limit')).toHaveValue(5)
      expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
      expect(screen.getAllByText('*')).toHaveLength(1)
    })
  })

  // Interaction updates
  describe('Interactions', () => {
    it('should update values and clear dependent fields when a field changes', () => {
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

      expect(onChange).toHaveBeenCalledWith({ api_key: 'new-key', dependent: 'reset' })
      expect(screen.getByText('Validating...')).toBeInTheDocument()
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

      expect(screen.getByText('EU')).toBeInTheDocument()
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

      expect(screen.getByText('Select A')).toBeInTheDocument()
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
          override={[[FormTypeEnum.textInput], () => <div>Override Field</div>]}
          customRenderField={schema => (
            <div>
              Custom Render:
              {schema.variable}
            </div>
          )}
        />,
      )

      expect(screen.getByText('Override Field')).toBeInTheDocument()
      expect(screen.getByText(/Custom Render:.*custom_field/)).toBeInTheDocument()
      expect(screen.getAllByText('allowed')).toHaveLength(3)
      expect(screen.getAllByText('blocked')).toHaveLength(1)

      fireEvent.click(screen.getAllByText('Pick Variable')[0])

      expect(onChange).toHaveBeenCalledWith({ override: '', any_var: [{ name: 'var-1' }], any_without_scope: [], custom_field: '' })
      expect(screen.getAllByText('Extra Info')).toHaveLength(2)
    })
  })
})
