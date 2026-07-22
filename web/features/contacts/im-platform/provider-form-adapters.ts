import type {
  ContactImAuthMode,
  ContactImProvider,
  ContactImProviderDefinition,
  ContactImProviderField,
} from './types'
import {
  ContactImAuthMode as AuthMode,
  ContactImProvider as Provider,
  ContactImProviderField as ProviderField,
} from './types'

type NonSecretProviderField = Exclude<ContactImProviderField, 'secret'>

export type ContactImCredentialFormAdapter = {
  authMode: Extract<ContactImAuthMode, 'credentials'>
  fields: NonSecretProviderField[]
  provider: Extract<ContactImProvider, 'dingtalk' | 'slack'>
  requiresSecret: true
}

export type ContactImOAuthFormAdapter = {
  authMode: Extract<ContactImAuthMode, 'oauth'>
  fields: []
  provider: Extract<ContactImProvider, 'feishu'>
  requiresSecret: false
}

export type ContactImProviderFormAdapter =
  | ContactImCredentialFormAdapter
  | ContactImOAuthFormAdapter

const getProviderFormAdapter = (provider: ContactImProvider): ContactImProviderFormAdapter => {
  switch (provider) {
    case Provider.Slack:
      return {
        authMode: AuthMode.Credentials,
        fields: [ProviderField.AppId],
        provider,
        requiresSecret: true,
      }
    case Provider.Feishu:
      return {
        authMode: AuthMode.OAuth,
        fields: [],
        provider,
        requiresSecret: false,
      }
    case Provider.DingTalk:
      return {
        authMode: AuthMode.Credentials,
        fields: [ProviderField.ClientId],
        provider,
        requiresSecret: true,
      }
    case Provider.Email:
      throw new Error('Email uses its dedicated configuration form')
  }
}

export const resolveContactImProviderFormAdapter = (definition: ContactImProviderDefinition) => {
  const adapter = getProviderFormAdapter(definition.provider)

  if (adapter.authMode !== definition.authMode)
    throw new Error(`Provider form adapter mismatch for ${definition.provider}`)

  return adapter
}
