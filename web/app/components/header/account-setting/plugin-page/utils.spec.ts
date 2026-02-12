import { updatePluginProviderAIKey, validatePluginProviderKey } from '@/service/common'
import { ValidatedStatus } from '../key-validator/declarations'
import { updatePluginKey, validatePluginKey } from './utils'

vi.mock('@/service/common', () => ({
  validatePluginProviderKey: vi.fn(),
  updatePluginProviderAIKey: vi.fn(),
}))

const mockValidatePluginProviderKey = validatePluginProviderKey as ReturnType<typeof vi.fn>
const mockUpdatePluginProviderAIKey = updatePluginProviderAIKey as ReturnType<typeof vi.fn>

describe('Plugin Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validatePluginKey', () => {
    it('should return success status when validation succeeds', async () => {
      mockValidatePluginProviderKey.mockResolvedValue({ result: 'success' })

      const result = await validatePluginKey('serpapi', { credentials: { api_key: 'test-key' } })

      expect(result.status).toBe(ValidatedStatus.Success)
    })

    it('should return error status with message when validation fails', async () => {
      const errorMessage = 'Invalid API key'
      mockValidatePluginProviderKey.mockResolvedValue({
        result: 'error',
        error: errorMessage,
      })

      const result = await validatePluginKey('serpapi', { credentials: { api_key: 'invalid' } })

      expect(result.status).toBe(ValidatedStatus.Error)
      expect((result as unknown as { message: string }).message).toBe(errorMessage)
    })

    it('should return error status when service throws exception', async () => {
      const errorMessage = 'Network error'
      mockValidatePluginProviderKey.mockRejectedValue(new Error(errorMessage))

      const result = await validatePluginKey('serpapi', { credentials: { api_key: 'test' } })

      expect(result.status).toBe(ValidatedStatus.Error)
      expect((result as unknown as { message: string }).message).toBe(errorMessage)
    })
  })

  describe('updatePluginKey', () => {
    it('should return success status when update succeeds', async () => {
      mockUpdatePluginProviderAIKey.mockResolvedValue({ result: 'success' })

      const result = await updatePluginKey('serpapi', { credentials: { api_key: 'new-key' } })

      expect(result.status).toBe(ValidatedStatus.Success)
    })

    it('should return error status with message when update fails', async () => {
      const errorMessage = 'Update failed'
      mockUpdatePluginProviderAIKey.mockResolvedValue({
        result: 'error',
        error: errorMessage,
      })

      const result = await updatePluginKey('serpapi', { credentials: { api_key: 'test' } })

      expect(result.status).toBe(ValidatedStatus.Error)
      expect((result as unknown as { message: string }).message).toBe(errorMessage)
    })

    it('should return error status when service throws exception', async () => {
      const errorMessage = 'Request failed'
      mockUpdatePluginProviderAIKey.mockRejectedValue(new Error(errorMessage))

      const result = await updatePluginKey('serpapi', { credentials: { api_key: 'test' } })

      expect(result.status).toBe(ValidatedStatus.Error)
      expect((result as unknown as { message: string }).message).toBe(errorMessage)
    })
  })
})
