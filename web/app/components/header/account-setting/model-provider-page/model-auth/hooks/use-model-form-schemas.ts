import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Credential,
  CustomModelCredential,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../../declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
} from '../../utils'
import { FormTypeEnum } from '@/app/components/base/form/types'

export const useModelFormSchemas = (
  provider: ModelProvider,
  providerFormSchemaPredefined: boolean,
  credentials?: Record<string, any>,
  credential?: Credential,
  model?: CustomModelCredential,
  draftConfig?: ModelLoadBalancingConfig,
) => {
  const { t } = useTranslation()
  const {
    provider_credential_schema,
    supported_model_types,
    model_credential_schema,
  } = provider
  const formSchemas = useMemo(() => {
    const modelTypeSchema = genModelTypeFormSchema(supported_model_types)
    const modelNameSchema = genModelNameFormSchema(model_credential_schema?.model)
    if (!!model) {
      modelTypeSchema.disabled = true
      modelNameSchema.disabled = true
    }
    return providerFormSchemaPredefined
      ? provider_credential_schema.credential_form_schemas
      : [
        modelTypeSchema,
        modelNameSchema,
        ...(draftConfig?.enabled ? [] : model_credential_schema.credential_form_schemas),
      ]
  }, [
    providerFormSchemaPredefined,
    provider_credential_schema?.credential_form_schemas,
    supported_model_types,
    model_credential_schema?.credential_form_schemas,
    model_credential_schema?.model,
    draftConfig?.enabled,
    model,
  ])

  const formSchemasWithAuthorizationName = useMemo(() => {
    const authorizationNameSchema = {
      type: FormTypeEnum.textInput,
      variable: '__authorization_name__',
      label: t('plugin.auth.authorizationName'),
      required: true,
    }

    return [
      authorizationNameSchema,
      ...formSchemas,
    ]
  }, [formSchemas, t])

  const formValues = useMemo(() => {
    let result = {}
    if (credential) {
      result = { ...result, __authorization_name__: credential?.credential_name }
      if (credentials)
        result = { ...result, ...credentials }
    }
    if (model)
      result = { ...result, __model_name: model?.model, __model_type: model?.model_type }
    return result
  }, [credentials, credential, model])

  return {
    formSchemas: formSchemasWithAuthorizationName,
    formValues,
  }
}
