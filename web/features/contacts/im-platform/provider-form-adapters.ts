import type { ContactImProviderDefinition } from './types'
import { ContactImAuthMode, ContactImProvider, ContactImProviderField } from './types'

export const resolveContactImProviderFormAdapter = (definition: ContactImProviderDefinition) => {
  if (definition.provider === ContactImProvider.Email)
    throw new Error('Email uses its dedicated configuration form')
  if (definition.authMode !== ContactImAuthMode.Credentials)
    throw new Error(`Provider requires application credentials: ${definition.provider}`)

  return {
    fields: definition.requiredFields.map((field) => ({
      ...field,
      secret: field.secret || field.field === ContactImProviderField.Secret,
    })),
  }
}
