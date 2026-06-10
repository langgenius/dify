import type { ModelItem, ModelProvider } from '../../declarations'
import type { CredentialPanelState } from '../../provider-added-card/use-credential-panel-state'
import { ModelStatusEnum } from '../../declarations'
import { deriveTriggerStatus } from '../derive-trigger-status'

const baseCredentialState: CredentialPanelState = {
  variant: 'api-active',
  priority: 'apiKey',
  supportsCredits: true,
  showPrioritySwitcher: true,
  hasCredentials: true,
  isCreditsExhausted: false,
  credentialName: 'Primary Key',
  credits: 10,
}

const mockProvider = { provider: 'openai' } as ModelProvider
const mockModel = { model: 'gpt-4', status: ModelStatusEnum.active } as ModelItem

describe('deriveTriggerStatus', () => {
  it('returns empty when modelId is missing', () => {
    expect(deriveTriggerStatus(undefined, 'openai', mockProvider, mockModel, baseCredentialState)).toBe('empty')
  })

  it('returns empty when providerName is missing', () => {
    expect(deriveTriggerStatus('gpt-4', undefined, mockProvider, mockModel, baseCredentialState)).toBe('empty')
  })

  it('returns incompatible when provider plugin is not installed', () => {
    expect(deriveTriggerStatus('gpt-4', 'openai', undefined, mockModel, baseCredentialState)).toBe('incompatible')
  })

  it('returns credits-exhausted when credits priority and exhausted', () => {
    const state: CredentialPanelState = {
      ...baseCredentialState,
      priority: 'credits',
      isCreditsExhausted: true,
    }
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, mockModel, state)).toBe('credits-exhausted')
  })

  it('returns active when credits priority but not exhausted', () => {
    const state: CredentialPanelState = {
      ...baseCredentialState,
      priority: 'credits',
      isCreditsExhausted: false,
    }
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, mockModel, state)).toBe('active')
  })

  it('returns api-key-unavailable when variant is api-unavailable', () => {
    const state: CredentialPanelState = {
      ...baseCredentialState,
      variant: 'api-unavailable',
    }
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, mockModel, state)).toBe('api-key-unavailable')
  })

  it('returns incompatible when currentModel is missing (deprecated)', () => {
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, undefined, baseCredentialState)).toBe('incompatible')
  })

  it('returns credits-exhausted when currentModel is missing and AI credits are exhausted without api key', () => {
    const state: CredentialPanelState = {
      ...baseCredentialState,
      priority: 'apiKey',
      hasCredentials: false,
      isCreditsExhausted: true,
      credentialName: undefined,
    }
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, undefined, state)).toBe('credits-exhausted')
  })

  it('returns configure-required when model status is no-configure', () => {
    const model = { ...mockModel, status: ModelStatusEnum.noConfigure } as ModelItem
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, model, baseCredentialState)).toBe('configure-required')
  })

  it('returns incompatible when model status is noPermission', () => {
    const model = { ...mockModel, status: ModelStatusEnum.noPermission } as ModelItem
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, model, baseCredentialState)).toBe('incompatible')
  })

  it('returns disabled when model status is disabled', () => {
    const model = { ...mockModel, status: ModelStatusEnum.disabled } as ModelItem
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, model, baseCredentialState)).toBe('disabled')
  })

  it('returns active when all conditions are satisfied', () => {
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, mockModel, baseCredentialState)).toBe('active')
  })

  it('prioritises credits-exhausted over api-unavailable', () => {
    const state: CredentialPanelState = {
      ...baseCredentialState,
      priority: 'credits',
      isCreditsExhausted: true,
      variant: 'api-unavailable',
    }
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, mockModel, state)).toBe('credits-exhausted')
  })

  it('does not return credits-exhausted when supportsCredits is false', () => {
    const state: CredentialPanelState = {
      ...baseCredentialState,
      priority: 'credits',
      isCreditsExhausted: true,
      supportsCredits: false,
    }
    expect(deriveTriggerStatus('gpt-4', 'openai', mockProvider, mockModel, state)).toBe('active')
  })
})
