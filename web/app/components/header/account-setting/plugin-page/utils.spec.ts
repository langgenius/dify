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

  describe.each([
    {
      name: 'validatePluginKey',
      utilFn: validatePluginKey,
      serviceMock: mockValidatePluginProviderKey,
      successBody: { credentials: { api_key: 'test-key' } },
      failureBody: { credentials: { api_key: 'invalid' } },
      exceptionBody: { credentials: { api_key: 'test' } },
      serviceErrorMessage: 'Invalid API key',
      thrownErrorMessage: 'Network error',
    },
    {
      name: 'updatePluginKey',
      utilFn: updatePluginKey,
      serviceMock: mockUpdatePluginProviderAIKey,
      successBody: { credentials: { api_key: 'new-key' } },
      failureBody: { credentials: { api_key: 'test' } },
      exceptionBody: { credentials: { api_key: 'test' } },
      serviceErrorMessage: 'Update failed',
      thrownErrorMessage: 'Request failed',
    },
  ])('$name', ({ utilFn, serviceMock, successBody, failureBody, exceptionBody, serviceErrorMessage, thrownErrorMessage }) => {
    it('should return success status when service succeeds', async () => {
      serviceMock.mockResolvedValue({ result: 'success' })

      const result = await utilFn('serpapi', successBody)

      expect(result.status).toBe(ValidatedStatus.Success)
    })

    it('should return error status with message when service returns an error', async () => {
      serviceMock.mockResolvedValue({
        result: 'error',
        error: serviceErrorMessage,
      })

      const result = await utilFn('serpapi', failureBody)

      expect(result).toMatchObject({
        status: ValidatedStatus.Error,
        message: serviceErrorMessage,
      })
    })

    it('should return error status when service throws exception', async () => {
      serviceMock.mockRejectedValue(new Error(thrownErrorMessage))

      const result = await utilFn('serpapi', exceptionBody)

      expect(result).toMatchObject({
        status: ValidatedStatus.Error,
        message: thrownErrorMessage,
      })
    })
  })
})
