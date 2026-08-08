import type { CredentialCandidate, CredentialSlot } from '@dify/contracts/enterprise/types.gen'
import { PluginCategory } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialCandidateOptions,
  runtimeCredentialProviderName,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '../runtime-credential-bindings-utils'

function candidate(overrides: Partial<CredentialCandidate>): CredentialCandidate {
  return {
    credentialId: 'credential-1',
    providerId: 'langgenius/openai',
    category: PluginCategory.PLUGIN_CATEGORY_MODEL,
    displayName: 'OpenAI key',
    fromEnterprise: false,
    ...overrides,
  }
}

function slot(overrides: Partial<CredentialSlot>): CredentialSlot {
  return {
    providerId: 'langgenius/openai',
    category: PluginCategory.PLUGIN_CATEGORY_MODEL,
    candidates: [
      candidate({ credentialId: 'credential-1', displayName: 'Primary key' }),
      candidate({ credentialId: 'credential-2', displayName: 'Backup key' }),
    ],
    lastCredentialId: '',
    ...overrides,
  }
}

describe('runtime credential provider names', () => {
  it('should resolve known provider slugs and title-case custom slugs', () => {
    expect(runtimeCredentialProviderName('langgenius/openai')).toBe('OpenAI')
    expect(runtimeCredentialProviderName('langgenius/azure_openai')).toBe('Azure OpenAI')
    expect(runtimeCredentialProviderName('custom/my-provider')).toBe('My Provider')
    expect(runtimeCredentialProviderName('/')).toBeUndefined()
  })
})

describe('runtime credential selection helpers', () => {
  it('should build stable slot keys and candidate labels', () => {
    const credentialSlot = slot({
      candidates: [
        candidate({
          credentialId: 'credential-1',
          providerId: 'langgenius/openai',
          displayName: 'Production key · langgenius/openai',
        }),
        candidate({
          credentialId: 'credential-2',
          providerId: 'langgenius/openai',
          displayName: 'Backup key (langgenius/openai)',
        }),
        candidate({
          credentialId: 'credential-3',
          providerId: 'langgenius/openai',
          displayName: '',
        }),
      ],
    })

    expect(runtimeCredentialSlotKey(credentialSlot)).toBe('langgenius/openai:PLUGIN_CATEGORY_MODEL')
    expect(runtimeCredentialCandidateOptions(credentialSlot)).toEqual([
      { value: 'credential-1', label: 'Production key' },
      { value: 'credential-2', label: 'Backup key' },
      { value: 'credential-3', label: 'credential-3' },
    ])
  })

  it('should prefer valid manual selections before last or only candidates', () => {
    const firstSlot = slot({
      providerId: 'langgenius/openai',
      lastCredentialId: 'credential-2',
    })
    const secondSlot = slot({
      providerId: 'langgenius/bedrock',
      candidates: [candidate({ credentialId: 'bedrock-1', providerId: 'langgenius/bedrock' })],
      lastCredentialId: '',
    })
    const thirdSlot = slot({
      providerId: 'custom/empty',
      candidates: [
        candidate({ credentialId: 'empty-1', providerId: 'custom/empty' }),
        candidate({ credentialId: 'empty-2', providerId: 'custom/empty' }),
      ],
      lastCredentialId: 'stale',
    })

    expect(
      selectedRuntimeCredentialSelections([firstSlot, secondSlot, thirdSlot], {
        [runtimeCredentialSlotKey(firstSlot)]: 'credential-1',
        [runtimeCredentialSlotKey(secondSlot)]: 'stale',
      }),
    ).toEqual({
      [runtimeCredentialSlotKey(firstSlot)]: 'credential-1',
      [runtimeCredentialSlotKey(secondSlot)]: 'bedrock-1',
    })
  })

  it('should convert selected credentials into deployment payload inputs', () => {
    const firstSlot = slot({ providerId: 'langgenius/openai' })
    const secondSlot = slot({ providerId: 'langgenius/bedrock' })

    expect(hasMissingRequiredRuntimeCredentialBinding(firstSlot)).toBe(true)
    expect(hasMissingRequiredRuntimeCredentialBinding(firstSlot, 'credential-1')).toBe(false)
    expect(
      selectedDeploymentRuntimeCredentials([firstSlot, secondSlot], {
        [runtimeCredentialSlotKey(firstSlot)]: 'credential-1',
      }),
    ).toEqual([
      {
        providerId: 'langgenius/openai',
        category: PluginCategory.PLUGIN_CATEGORY_MODEL,
        credentialId: 'credential-1',
      },
    ])
  })
})
