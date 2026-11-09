import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { renderHook } from '@testing-library/react'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { modelProviderDetailsQueryOptions } from '../../../utils'
import { useCredentialStatus } from '../use-credential-status'

const credentials = [{ credential_id: '123', credential_name: 'Key' }]
const detail = (configuration: Parameters<typeof createProviderResponseFixture>[0] = {}) =>
  modelProviderDetailsQueryOptions().select!({
    data: [createProviderResponseFixture(configuration)],
  }).data[0]!

it('tracks selection, removal and credential restrictions from provider details', () => {
  const { result, rerender } = renderHook(({ provider }) => useCredentialStatus(provider), {
    initialProps: {
      provider: detail({
        custom_configuration: {
          current_credential_id: '123',
          current_credential_name: 'Key',
          available_credentials: credentials,
        },
      }),
    },
  })
  expect(result.current).toMatchObject({
    hasCredential: true,
    authorized: true,
    authRemoved: false,
  })
  rerender({ provider: detail({ custom_configuration: { available_credentials: credentials } }) })
  expect(result.current).toMatchObject({
    hasCredential: true,
    authorized: false,
    authRemoved: true,
  })
  rerender({
    provider: {
      ...detail(),
      custom_configuration: {
        ...detail().custom_configuration,
        current_credential_id: '123',
        current_credential_name: 'Key',
        available_credentials: [{ ...credentials[0]!, not_allowed_to_use: true }],
      },
    },
  })
  expect(result.current).toMatchObject({ authorized: false, notAllowedToUse: true })
  rerender({ provider: detail({ custom_configuration: { available_credentials: [] } }) })
  expect(result.current).toMatchObject({
    hasCredential: false,
    authorized: false,
    authRemoved: false,
  })
})

it('gives the summary usability flag precedence over credential selection', () => {
  const provider: ModelProviderSummaryResponse = {
    provider: 'openai',
    plugin_id: 'openai',
    label: { en_US: 'OpenAI' },
    supported_model_types: ['llm'],
    configurate_methods: ['predefined-model'],
    preferred_provider_type: 'custom',
    is_configured: true,
    system_configuration: { enabled: false },
    custom_configuration: {
      status: 'active',
      has_custom_models: false,
      current_credential_id: '123',
      current_credential_name: 'Key',
      current_credential_usable: false,
      available_credentials: credentials,
    },
  }
  const { result } = renderHook(() => useCredentialStatus(provider))
  expect(result.current).toMatchObject({
    hasCredential: true,
    authorized: false,
    notAllowedToUse: true,
  })
})

it('reports no authorization before a provider is available', () => {
  const { result } = renderHook(() => useCredentialStatus(undefined))
  expect(result.current).toMatchObject({
    hasCredential: false,
    authorized: false,
    authRemoved: false,
  })
})
