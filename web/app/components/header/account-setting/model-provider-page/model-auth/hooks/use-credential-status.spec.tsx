import type { ModelProvider } from '../../declarations'
import { renderHook } from '@testing-library/react'
import { useCredentialStatus } from './use-credential-status'

describe('useCredentialStatus', () => {
  it('computes authorized and authRemoved status correctly', () => {
    // Authorized case
    const authProvider = {
      custom_configuration: {
        current_credential_id: '123',
        current_credential_name: 'Key',
        available_credentials: [{ credential_id: '123', credential_name: 'Key' }],
      },
    } as unknown as ModelProvider
    const { result: authRes } = renderHook(() => useCredentialStatus(authProvider))
    expect(authRes.current.authorized).toBeTruthy()
    expect(authRes.current.authRemoved).toBe(false)

    // AuthRemoved case (found but not selected)
    const removedProvider = {
      custom_configuration: {
        current_credential_id: '',
        current_credential_name: '',
        available_credentials: [{ credential_id: '123' }],
      },
    } as unknown as ModelProvider
    const { result: removedRes } = renderHook(() => useCredentialStatus(removedProvider))
    expect(removedRes.current.authRemoved).toBe(true)
    expect(removedRes.current.authorized).toBeFalsy()
  })

  it('handles empty or restricted credentials', () => {
    // Empty case
    const emptyProvider = {
      custom_configuration: { available_credentials: [] },
    } as unknown as ModelProvider
    const { result: emptyRes } = renderHook(() => useCredentialStatus(emptyProvider))
    expect(emptyRes.current.hasCredential).toBe(false)

    // Restricted case
    const restrictedProvider = {
      custom_configuration: {
        current_credential_id: '123',
        available_credentials: [{ credential_id: '123', not_allowed_to_use: true }],
      },
    } as unknown as ModelProvider
    const { result: restrictedRes } = renderHook(() => useCredentialStatus(restrictedProvider))
    expect(restrictedRes.current.notAllowedToUse).toBe(true)
  })

  it('handles undefined custom configuration gracefully', () => {
    const { result } = renderHook(() => useCredentialStatus({ custom_configuration: {} } as ModelProvider))
    expect(result.current.hasCredential).toBe(false)
    expect(result.current.available_credentials).toBeUndefined()
  })
})
