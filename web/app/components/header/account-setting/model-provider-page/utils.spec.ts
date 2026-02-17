import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import {
  deleteModelProvider,
  setModelProvider,
  validateModelLoadBalancingCredentials,
  validateModelProvider,
} from '@/service/common'
import { ValidatedStatus } from '../key-validator/declarations'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  ModelTypeEnum,
} from './declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
  modelTypeFormat,
  removeCredentials,
  saveCredentials,
  savePredefinedLoadBalancingConfig,
  sizeFormat,
  validateCredentials,
  validateLoadBalancingCredentials,
} from './utils'

// Mock service/common functions
vi.mock('@/service/common', () => ({
  deleteModelProvider: vi.fn(),
  setModelProvider: vi.fn(),
  validateModelLoadBalancingCredentials: vi.fn(),
  validateModelProvider: vi.fn(),
}))

describe('utils', () => {
  afterEach(() => {
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
  })

  describe('genModelTypeFormSchema', () => {
    it('should generate form schema', () => {
      const schema = genModelTypeFormSchema([ModelTypeEnum.textGeneration])
      expect(schema.type).toBe(FormTypeEnum.select)
      expect(schema.variable).toBe('__model_type')
      expect(schema.options[0].value).toBe(ModelTypeEnum.textGeneration)
    })
  })

  describe('genModelNameFormSchema', () => {
    it('should generate form schema', () => {
      const schema = genModelNameFormSchema()
      expect(schema.type).toBe(FormTypeEnum.textInput)
      expect(schema.variable).toBe('__model_name')
      expect(schema.required).toBe(true)
    })
  })
})
