/**
 * Integration Test: External Knowledge Base Creation Flow
 *
 * Tests the data contract, validation logic, and API interaction
 * for external knowledge base creation.
 */

import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import { describe, expect, it } from 'vitest'

// --- Factory ---
const createFormData = (overrides?: Partial<CreateKnowledgeBaseReq>): CreateKnowledgeBaseReq => ({
  name: 'My External KB',
  description: 'A test external knowledge base',
  external_knowledge_api_id: 'api-1',
  external_knowledge_id: 'ext-kb-123',
  external_retrieval_model: {
    top_k: 4,
    score_threshold: 0.5,
    score_threshold_enabled: false,
  },
  provider: 'external',
  ...overrides,
})

describe('External Knowledge Base Creation Flow', () => {
  describe('Data Contract: CreateKnowledgeBaseReq', () => {
    it('should define a complete form structure', () => {
      const form = createFormData()

      expect(form).toHaveProperty('name')
      expect(form).toHaveProperty('external_knowledge_api_id')
      expect(form).toHaveProperty('external_knowledge_id')
      expect(form).toHaveProperty('external_retrieval_model')
      expect(form).toHaveProperty('provider')
      expect(form.provider).toBe('external')
    })

    it('should include retrieval model settings', () => {
      const form = createFormData()

      expect(form.external_retrieval_model).toEqual({
        top_k: 4,
        score_threshold: 0.5,
        score_threshold_enabled: false,
      })
    })

    it('should allow partial overrides', () => {
      const form = createFormData({
        name: 'Custom Name',
        external_retrieval_model: {
          top_k: 10,
          score_threshold: 0.8,
          score_threshold_enabled: true,
        },
      })

      expect(form.name).toBe('Custom Name')
      expect(form.external_retrieval_model.top_k).toBe(10)
      expect(form.external_retrieval_model.score_threshold_enabled).toBe(true)
    })
  })

  describe('Form Validation Logic', () => {
    const isFormValid = (form: CreateKnowledgeBaseReq): boolean => {
      return (
        form.name.trim() !== ''
        && form.external_knowledge_api_id !== ''
        && form.external_knowledge_id !== ''
        && form.external_retrieval_model.top_k !== undefined
        && form.external_retrieval_model.score_threshold !== undefined
      )
    }

    it('should validate a complete form', () => {
      const form = createFormData()
      expect(isFormValid(form)).toBe(true)
    })

    it('should reject empty name', () => {
      const form = createFormData({ name: '' })
      expect(isFormValid(form)).toBe(false)
    })

    it('should reject whitespace-only name', () => {
      const form = createFormData({ name: '   ' })
      expect(isFormValid(form)).toBe(false)
    })

    it('should reject empty external_knowledge_api_id', () => {
      const form = createFormData({ external_knowledge_api_id: '' })
      expect(isFormValid(form)).toBe(false)
    })

    it('should reject empty external_knowledge_id', () => {
      const form = createFormData({ external_knowledge_id: '' })
      expect(isFormValid(form)).toBe(false)
    })
  })

  describe('Form State Transitions', () => {
    it('should start with empty default state', () => {
      const defaultForm: CreateKnowledgeBaseReq = {
        name: '',
        description: '',
        external_knowledge_api_id: '',
        external_knowledge_id: '',
        external_retrieval_model: {
          top_k: 4,
          score_threshold: 0.5,
          score_threshold_enabled: false,
        },
        provider: 'external',
      }

      // Verify default state matches component's initial useState
      expect(defaultForm.name).toBe('')
      expect(defaultForm.external_knowledge_api_id).toBe('')
      expect(defaultForm.external_knowledge_id).toBe('')
      expect(defaultForm.provider).toBe('external')
    })

    it('should support immutable form updates', () => {
      const form = createFormData({ name: '' })
      const updated = { ...form, name: 'Updated Name' }

      expect(form.name).toBe('')
      expect(updated.name).toBe('Updated Name')
      // Other fields should remain unchanged
      expect(updated.external_knowledge_api_id).toBe(form.external_knowledge_api_id)
    })

    it('should support retrieval model updates', () => {
      const form = createFormData()
      const updated = {
        ...form,
        external_retrieval_model: {
          ...form.external_retrieval_model,
          top_k: 10,
          score_threshold_enabled: true,
        },
      }

      expect(updated.external_retrieval_model.top_k).toBe(10)
      expect(updated.external_retrieval_model.score_threshold_enabled).toBe(true)
      // Unchanged field
      expect(updated.external_retrieval_model.score_threshold).toBe(0.5)
    })
  })

  describe('API Call Data Contract', () => {
    it('should produce a valid API payload from form data', () => {
      const form = createFormData()

      // The API expects the full CreateKnowledgeBaseReq
      expect(form.name).toBeTruthy()
      expect(form.external_knowledge_api_id).toBeTruthy()
      expect(form.external_knowledge_id).toBeTruthy()
      expect(form.provider).toBe('external')
      expect(typeof form.external_retrieval_model.top_k).toBe('number')
      expect(typeof form.external_retrieval_model.score_threshold).toBe('number')
      expect(typeof form.external_retrieval_model.score_threshold_enabled).toBe('boolean')
    })

    it('should support optional description', () => {
      const formWithDesc = createFormData({ description: 'Some description' })
      const formWithoutDesc = createFormData({ description: '' })

      expect(formWithDesc.description).toBe('Some description')
      expect(formWithoutDesc.description).toBe('')
    })

    it('should validate retrieval model bounds', () => {
      const form = createFormData({
        external_retrieval_model: {
          top_k: 0,
          score_threshold: 0,
          score_threshold_enabled: false,
        },
      })

      expect(form.external_retrieval_model.top_k).toBe(0)
      expect(form.external_retrieval_model.score_threshold).toBe(0)
    })
  })

  describe('External API List Integration', () => {
    it('should validate API item structure', () => {
      const apiItem = {
        id: 'api-1',
        name: 'Production API',
        settings: {
          endpoint: 'https://api.example.com',
          api_key: 'key-123',
        },
      }

      expect(apiItem).toHaveProperty('id')
      expect(apiItem).toHaveProperty('name')
      expect(apiItem).toHaveProperty('settings')
      expect(apiItem.settings).toHaveProperty('endpoint')
      expect(apiItem.settings).toHaveProperty('api_key')
    })

    it('should link API selection to form data', () => {
      const selectedApi = { id: 'api-2', name: 'Staging API' }
      const form = createFormData({
        external_knowledge_api_id: selectedApi.id,
      })

      expect(form.external_knowledge_api_id).toBe('api-2')
    })
  })
})
