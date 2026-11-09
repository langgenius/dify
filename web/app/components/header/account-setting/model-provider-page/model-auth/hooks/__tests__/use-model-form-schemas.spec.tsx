import type {
  Credential,
  CredentialFormSchema,
  CustomModelCredential,
  ModelProvider,
} from '../../../declarations'
import { renderHook } from '@testing-library/react'
import { useModelFormSchemas } from '../use-model-form-schemas'

const field = (variable: string): CredentialFormSchema => ({
  name: variable,
  variable,
  type: 'text-input',
  label: { en_US: variable, zh_Hans: variable },
  required: true,
  show_on: [],
  default: 'default-value',
})
const provider: ModelProvider = {
  provider: 'openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  provider_credential_schema: { credential_form_schemas: [field('api_key')] },
  model_credential_schema: {
    model: {
      label: { en_US: 'Model', zh_Hans: 'Model' },
      placeholder: { en_US: 'Model', zh_Hans: 'Model' },
    },
    credential_form_schemas: [field('model_key')],
  },
  supported_model_types: ['llm'],
  configurate_methods: ['predefined-model', 'customizable-model'],
  preferred_provider_type: 'custom',
  custom_configuration: { status: 'active' },
  system_configuration: { enabled: false, quota_configurations: [] },
}
const credential: Credential = { credential_id: 'credential-1', credential_name: 'Production' }
const model: CustomModelCredential = { model: 'gpt-4', model_type: 'llm' }

describe('useModelFormSchemas', () => {
  it.each([
    [true, 'api_key'],
    [false, 'model_key'],
  ] as const)('uses the correct credential schema for predefined=%s', (predefined, variable) => {
    const { result } = renderHook(() => useModelFormSchemas(provider, predefined))
    expect(result.current.formSchemas.map((schema) => schema.variable)).toEqual([
      '__authorization_name__',
      variable,
    ])
    expect(result.current.formValues).toEqual({ [variable]: 'default-value' })
    expect(result.current.modelNameAndTypeFormSchemas.map((schema) => schema.variable)).toEqual(
      predefined ? [] : ['__model_name', '__model_type'],
    )
  })

  it('prefills saved credentials over defaults and retains custom model identity', () => {
    const { result } = renderHook(() =>
      useModelFormSchemas(provider, false, { model_key: 'saved-key' }, credential, model),
    )
    expect(result.current.formValues).toEqual({
      model_key: 'saved-key',
      __authorization_name__: 'Production',
      __model_name: 'gpt-4',
      __model_type: 'llm',
    })
    expect(result.current.modelNameAndTypeFormValues).toEqual({
      __model_name: 'gpt-4',
      __model_type: 'llm',
    })
  })
})
