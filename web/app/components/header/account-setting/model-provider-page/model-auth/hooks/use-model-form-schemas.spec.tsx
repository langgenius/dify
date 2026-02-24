import type {
  Credential,
  CustomModelCredential,
  ModelProvider,
} from '../../declarations'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useModelFormSchemas } from './use-model-form-schemas'

vi.mock('../../utils', () => ({
  genModelNameFormSchema: vi.fn(() => ({
    type: FormTypeEnum.textInput,
    variable: '__model_name',
    label: 'Model Name',
    required: true,
  })),
  genModelTypeFormSchema: vi.fn(() => ({
    type: FormTypeEnum.select,
    variable: '__model_type',
    label: 'Model Type',
    required: true,
  })),
}))

describe('useModelFormSchemas', () => {
  const mockProvider = {
    provider: 'openai',
    provider_credential_schema: {
      credential_form_schemas: [
        { type: FormTypeEnum.textInput, variable: 'api_key', label: 'API Key', required: true },
      ],
    },
    model_credential_schema: {
      credential_form_schemas: [
        { type: FormTypeEnum.textInput, variable: 'model_key', label: 'Model Key', required: true },
      ],
    },
    supported_model_types: ['text-generation'],
  } as unknown as ModelProvider

  it('selects correct form schemas based on providerFormSchemaPredefined', () => {
    const { result: providerResult } = renderHook(() => useModelFormSchemas(mockProvider, true))
    expect(providerResult.current.formSchemas.some(s => s.variable === 'api_key')).toBe(true)

    const { result: modelResult } = renderHook(() => useModelFormSchemas(mockProvider, false))
    expect(modelResult.current.formSchemas.some(s => s.variable === 'model_key')).toBe(true)

    const { result: emptyResult } = renderHook(() => useModelFormSchemas({} as unknown as ModelProvider, true))
    expect(emptyResult.current.formSchemas).toHaveLength(1) // only __authorization_name__
  })

  it('computes form values correctly for credentials and models', () => {
    const mockCredential = { credential_name: 'Test' } as unknown as Credential
    const mockModel = { model: 'gpt-4', model_type: 'text-generation' } as unknown as CustomModelCredential
    const { result } = renderHook(() => useModelFormSchemas(mockProvider, true, { api_key: 'val' }, mockCredential, mockModel))
    expect((result.current.formValues as Record<string, unknown>).api_key).toBe('val')
    expect((result.current.formValues as Record<string, unknown>).__authorization_name__).toBe('Test')
    expect((result.current.formValues as Record<string, unknown>).__model_name).toBe('gpt-4')

    // Branch: credential present but credentials (param) missing
    const { result: emptyCredsRes } = renderHook(() => useModelFormSchemas(mockProvider, true, undefined, mockCredential))
    expect((emptyCredsRes.current.formValues as Record<string, unknown>).__authorization_name__).toBe('Test')
  })

  it('handles model name and type schemas for custom models', () => {
    const { result: predefined } = renderHook(() => useModelFormSchemas(mockProvider, true))
    expect(predefined.current.modelNameAndTypeFormSchemas).toHaveLength(0)

    const { result: custom } = renderHook(() => useModelFormSchemas(mockProvider, false))
    expect(custom.current.modelNameAndTypeFormSchemas).toHaveLength(2)
    expect(custom.current.modelNameAndTypeFormSchemas[0].variable).toBe('__model_name')

    const mockModel = { model: 'custom', model_type: 'text' } as unknown as CustomModelCredential
    const { result: customWithVal } = renderHook(() => useModelFormSchemas(mockProvider, false, undefined, undefined, mockModel))
    expect((customWithVal.current.modelNameAndTypeFormValues as Record<string, unknown>).__model_name).toBe('custom')
  })
})
