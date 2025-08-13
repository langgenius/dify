import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
} from '../utils'
import { FormTypeEnum } from '@/app/components/base/form/types'

export const useModelFormSchemas = (
  provider: ModelProvider,
  providerFormSchemaPredefined: boolean,
  draftConfig?: ModelLoadBalancingConfig,
) => {
  const { t } = useTranslation()
  const {
    provider_credential_schema,
    supported_model_types,
    model_credential_schema,
  } = provider
  const formSchemas = useMemo(() => {
    return providerFormSchemaPredefined
      ? provider_credential_schema.credential_form_schemas
      : [
        genModelTypeFormSchema(supported_model_types),
        genModelNameFormSchema(model_credential_schema?.model),
        ...(draftConfig?.enabled ? [] : model_credential_schema.credential_form_schemas),
      ]
  }, [
    providerFormSchemaPredefined,
    provider_credential_schema?.credential_form_schemas,
    supported_model_types,
    model_credential_schema?.credential_form_schemas,
    model_credential_schema?.model,
    draftConfig?.enabled,
  ])

  const formSchemasWithAuthorizationName = useMemo(() => {
    return [
      {
        type: FormTypeEnum.textInput,
        variable: '__authorization_name__',
        label: t('plugin.auth.authorizationName'),
        required: true,
      },
      ...formSchemas,
    ]
  }, [formSchemas, t])

  return {
    formSchemas: formSchemasWithAuthorizationName,
  }
}
