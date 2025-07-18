import type { AnyFormApi } from '@tanstack/react-form'
import type { FormSchema } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'

export const transformFormSchemasSecretInput = (isPristineSecretInputNames: string[], values: Record<string, any>) => {
  const transformedValues: Record<string, any> = { ...values }

  isPristineSecretInputNames.forEach((name) => {
    if (transformedValues[name])
      transformedValues[name] = '[__HIDDEN__]'
  })

  return transformedValues
}

export const getTransformedValuesWhenSecretInputPristine = (formSchemas: FormSchema[], form: AnyFormApi) => {
  const values = form?.store.state.values || {}
  const isPristineSecretInputNames: string[] = []
  for (let i = 0; i < formSchemas.length; i++) {
    const schema = formSchemas[i]
    if (schema.type === FormTypeEnum.secretInput) {
      const fieldMeta = form?.getFieldMeta(schema.name)
      if (fieldMeta?.isPristine)
        isPristineSecretInputNames.push(schema.name)
    }
  }

  return transformFormSchemasSecretInput(isPristineSecretInputNames, values)
}
