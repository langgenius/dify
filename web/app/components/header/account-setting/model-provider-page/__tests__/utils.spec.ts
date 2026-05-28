import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import {
  deleteModelProvider,
  setModelProvider,
  validateModelLoadBalancingCredentials,
  validateModelProvider,
} from '@/service/common'
import { ValidatedStatus } from '../../key-validator/declarations'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  ModelTypeEnum,
} from '../declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
  modelTypeFormat,
  providerToPluginId,
  removeCredentials,
  saveCredentials,
  savePredefinedLoadBalancingConfig,
  sizeFormat,
  validateCredentials,
  validateLoadBalancingCredentials,
} from '../utils'

// Mock service/common functions
vi.mock('@/service/common', () => ({
  deleteModelProvider: vi.fn(),
  setModelProvider: vi.fn(),
  validateModelLoadBalancingCredentials: vi.fn(),
  validateModelProvider: vi.fn(),
}))

describe('utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('sizeFormat', () => {
    it('should format size less than 1000', () => {
      expect(sizeFormat(500)).toBe('500')
    })

    it('should format size greater than 1000', () => {
      expect(sizeFormat(1500)).toBe('1K')
    })
  })

  describe('providerToPluginId', () => {
    it('should return the plugin id prefix when the provider key contains a provider segment', () => {
      expect(providerToPluginId('langgenius/openai/openai')).toBe('langgenius/openai')
    })

    it('should return an empty string when the provider key has no plugin prefix', () => {
      expect(providerToPluginId('openai')).toBe('')
    })
  })

  describe('modelTypeFormat', () => {
    it('should format text embedding type', () => {
      expect(modelTypeFormat(ModelTypeEnum.textEmbedding)).toBe('TEXT EMBEDDING')
    })

    it('should format other types', () => {
      expect(modelTypeFormat(ModelTypeEnum.textGeneration)).toBe('LLM')
    })
  })

  describe('validateCredentials', () => {
    it('should validate predefined credentials successfully', async () => {
      (validateModelProvider as unknown as Mock).mockResolvedValue({ result: 'success' })
      const result = await validateCredentials(true, 'provider', { key: 'value' })
      expect(result).toEqual({ status: ValidatedStatus.Success })
      expect(validateModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/credentials/validate',
        body: { credentials: { key: 'value' } },
      })
    })

    it('should validate custom credentials successfully', async () => {
      (validateModelProvider as unknown as Mock).mockResolvedValue({ result: 'success' })
      const result = await validateCredentials(false, 'provider', {
        __model_name: 'model',
        __model_type: 'type',
        key: 'value',
      })
      expect(result).toEqual({ status: ValidatedStatus.Success })
      expect(validateModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/models/credentials/validate',
        body: {
          model: 'model',
          model_type: 'type',
          credentials: { key: 'value' },
        },
      })
    })

    it('should handle validation failure', async () => {
      (validateModelProvider as unknown as Mock).mockResolvedValue({ result: 'error', error: 'failed' })
      const result = await validateCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'failed' })
    })

    it('should handle exception', async () => {
      (validateModelProvider as unknown as Mock).mockRejectedValue(new Error('network error'))
      const result = await validateCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'network error' })
    })

    it('should return Unknown error when non-Error is thrown', async () => {
      (validateModelProvider as unknown as Mock).mockRejectedValue('string error')
      const result = await validateCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'Unknown error' })
    })

    it('should return default error message when error field is empty', async () => {
      (validateModelProvider as unknown as Mock).mockResolvedValue({ result: 'error', error: '' })
      const result = await validateCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'error' })
    })
  })

  describe('validateLoadBalancingCredentials', () => {
    it('should validate load balancing credentials successfully', async () => {
      (validateModelLoadBalancingCredentials as unknown as Mock).mockResolvedValue({ result: 'success' })
      const result = await validateLoadBalancingCredentials(true, 'provider', {
        __model_name: 'model',
        __model_type: 'type',
        key: 'value',
      })
      expect(result).toEqual({ status: ValidatedStatus.Success })
      expect(validateModelLoadBalancingCredentials).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/models/load-balancing-configs/credentials-validate',
        body: {
          model: 'model',
          model_type: 'type',
          credentials: { key: 'value' },
        },
      })
    })
    it('should validate load balancing credentials successfully with id', async () => {
      (validateModelLoadBalancingCredentials as unknown as Mock).mockResolvedValue({ result: 'success' })
      const result = await validateLoadBalancingCredentials(true, 'provider', {
        __model_name: 'model',
        __model_type: 'type',
        key: 'value',
      }, 'id')
      expect(result).toEqual({ status: ValidatedStatus.Success })
      expect(validateModelLoadBalancingCredentials).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/models/load-balancing-configs/id/credentials-validate',
        body: {
          model: 'model',
          model_type: 'type',
          credentials: { key: 'value' },
        },
      })
    })

    it('should handle validation failure', async () => {
      (validateModelLoadBalancingCredentials as unknown as Mock).mockResolvedValue({ result: 'error', error: 'failed' })
      const result = await validateLoadBalancingCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'failed' })
    })

    it('should return Unknown error when non-Error is thrown', async () => {
      (validateModelLoadBalancingCredentials as unknown as Mock).mockRejectedValue(42)
      const result = await validateLoadBalancingCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'Unknown error' })
    })

    it('should handle exception with Error', async () => {
      (validateModelLoadBalancingCredentials as unknown as Mock).mockRejectedValue(new Error('Timeout'))
      const result = await validateLoadBalancingCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'Timeout' })
    })

    it('should return default error message when error field is empty', async () => {
      (validateModelLoadBalancingCredentials as unknown as Mock).mockResolvedValue({ result: 'error', error: '' })
      const result = await validateLoadBalancingCredentials(true, 'provider', {})
      expect(result).toEqual({ status: ValidatedStatus.Error, message: 'error' })
    })
  })

  describe('saveCredentials', () => {
    it('should save predefined credentials', async () => {
      await saveCredentials(true, 'provider', { __authorization_name__: 'name', key: 'value' })
      expect(setModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/credentials',
        body: {
          config_from: ConfigurationMethodEnum.predefinedModel,
          credentials: { key: 'value' },
          load_balancing: undefined,
          name: 'name',
        },
      })
    })

    it('should save custom credentials', async () => {
      await saveCredentials(false, 'provider', {
        __model_name: 'model',
        __model_type: 'type',
        key: 'value',
      })
      expect(setModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/models',
        body: {
          model: 'model',
          model_type: 'type',
          credentials: { key: 'value' },
          load_balancing: undefined,
        },
      })
    })
  })

  describe('savePredefinedLoadBalancingConfig', () => {
    it('should save predefined load balancing config', async () => {
      await savePredefinedLoadBalancingConfig('provider', {
        __model_name: 'model',
        __model_type: 'type',
        key: 'value',
      })
      expect(setModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/models',
        body: {
          config_from: ConfigurationMethodEnum.predefinedModel,
          model: 'model',
          model_type: 'type',
          credentials: { key: 'value' },
          load_balancing: undefined,
        },
      })
    })
  })

  describe('removeCredentials', () => {
    it('should remove predefined credentials', async () => {
      await removeCredentials(true, 'provider', {}, 'id')
      expect(deleteModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/credentials',
        body: { credential_id: 'id' },
      })
    })

    it('should remove custom credentials', async () => {
      await removeCredentials(false, 'provider', {
        __model_name: 'model',
        __model_type: 'type',
      })
      expect(deleteModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/models',
        body: {
          model: 'model',
          model_type: 'type',
        },
      })
    })

    it('should remove predefined credentials without credentialId', async () => {
      await removeCredentials(true, 'provider', {})
      expect(deleteModelProvider).toHaveBeenCalledWith({
        url: '/workspaces/current/model-providers/provider/credentials',
        body: undefined,
      })
    })

    it('should not call delete endpoint when non-predefined payload is falsy', async () => {
      await removeCredentials(false, 'provider', null as unknown as Record<string, unknown>)
      expect(deleteModelProvider).not.toHaveBeenCalled()
    })
  })

  describe('genModelTypeFormSchema', () => {
    it('should generate form schema', () => {
      const schema = genModelTypeFormSchema([ModelTypeEnum.textGeneration])
      expect(schema.type).toBe(FormTypeEnum.select)
      expect(schema.variable).toBe('__model_type')
      expect(schema.options[0]!.value).toBe(ModelTypeEnum.textGeneration)
    })
  })

  describe('genModelNameFormSchema', () => {
    it('should generate default form schema when no model provided', () => {
      const schema = genModelNameFormSchema()
      expect(schema.type).toBe(FormTypeEnum.textInput)
      expect(schema.variable).toBe('__model_name')
      expect(schema.required).toBe(true)
      expect(schema.label.en_US).toBe('Model Name')
      expect(schema.placeholder!.en_US).toBe('Please enter model name')
    })

    it('should use provided label and placeholder when model is given', () => {
      const schema = genModelNameFormSchema({
        label: { en_US: 'Custom', zh_Hans: 'Custom' },
        placeholder: { en_US: 'Enter custom', zh_Hans: 'Enter custom' },
      })
      expect(schema.label.en_US).toBe('Custom')
      expect(schema.placeholder!.en_US).toBe('Enter custom')
    })
  })
})
