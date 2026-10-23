import type { ContactImIntegrationView, ContactImProviderField } from './types'

/** Saved metadata permits an empty draft without putting a secret in the input value. */
export const canRetainCredential = (
  integration: ContactImIntegrationView | null,
  field: ContactImProviderField,
  requiresFreshCredentials = false,
) =>
  !requiresFreshCredentials &&
  Boolean(integration) &&
  (integration?.configuredFields?.includes(field) ??
    (field === 'secret'
      ? Boolean(integration?.secretConfigured)
      : Boolean(integration?.configuredValues[field])))
