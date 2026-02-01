import type { SetupStatusResponse } from '@/models/common'
import { consoleClient } from '@/service/client'
import { fetchSetupStatusWithCache } from './setup-status'

vi.mock('@/service/client', () => ({
  consoleClient: {
    setupStatus: vi.fn(),
  },
}))

const mockSetupStatus = vi.mocked(consoleClient.setupStatus)

describe('setup-status utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('fetchSetupStatusWithCache', () => {
    describe('when cache exists', () => {
      it('should return cached finished status without API call', async () => {
        localStorage.setItem('setup_status', 'finished')

        const result = await fetchSetupStatusWithCache()

        expect(result).toEqual({ step: 'finished' })
        expect(mockSetupStatus).not.toHaveBeenCalled()
      })

      it('should not modify localStorage when returning cached value', async () => {
        localStorage.setItem('setup_status', 'finished')

        await fetchSetupStatusWithCache()

        expect(localStorage.getItem('setup_status')).toBe('finished')
      })
    })

    describe('when cache does not exist', () => {
      it('should call API and cache finished status', async () => {
        const apiResponse: SetupStatusResponse = { step: 'finished' }
        mockSetupStatus.mockResolvedValue(apiResponse)

        const result = await fetchSetupStatusWithCache()

        expect(mockSetupStatus).toHaveBeenCalledTimes(1)
        expect(result).toEqual(apiResponse)
        expect(localStorage.getItem('setup_status')).toBe('finished')
      })

      it('should call API and remove cache when not finished', async () => {
        const apiResponse: SetupStatusResponse = { step: 'not_started' }
        mockSetupStatus.mockResolvedValue(apiResponse)

        const result = await fetchSetupStatusWithCache()

        expect(mockSetupStatus).toHaveBeenCalledTimes(1)
        expect(result).toEqual(apiResponse)
        expect(localStorage.getItem('setup_status')).toBeNull()
      })

      it('should clear stale cache when API returns not_started', async () => {
        localStorage.setItem('setup_status', 'some_invalid_value')
        const apiResponse: SetupStatusResponse = { step: 'not_started' }
        mockSetupStatus.mockResolvedValue(apiResponse)

        const result = await fetchSetupStatusWithCache()

        expect(result).toEqual(apiResponse)
        expect(localStorage.getItem('setup_status')).toBeNull()
      })
    })

    describe('cache edge cases', () => {
      it('should call API when cache value is empty string', async () => {
        localStorage.setItem('setup_status', '')
        const apiResponse: SetupStatusResponse = { step: 'finished' }
        mockSetupStatus.mockResolvedValue(apiResponse)

        const result = await fetchSetupStatusWithCache()

        expect(mockSetupStatus).toHaveBeenCalledTimes(1)
        expect(result).toEqual(apiResponse)
      })

      it('should call API when cache value is not "finished"', async () => {
        localStorage.setItem('setup_status', 'not_started')
        const apiResponse: SetupStatusResponse = { step: 'finished' }
        mockSetupStatus.mockResolvedValue(apiResponse)

        const result = await fetchSetupStatusWithCache()

        expect(mockSetupStatus).toHaveBeenCalledTimes(1)
        expect(result).toEqual(apiResponse)
      })

      it('should call API when localStorage key does not exist', async () => {
        const apiResponse: SetupStatusResponse = { step: 'finished' }
        mockSetupStatus.mockResolvedValue(apiResponse)

        const result = await fetchSetupStatusWithCache()

        expect(mockSetupStatus).toHaveBeenCalledTimes(1)
        expect(result).toEqual(apiResponse)
      })
    })

    describe('API response handling', () => {
      it('should preserve setup_at from API response', async () => {
        const setupDate = '2024-01-01T00:00:00.000Z'
        const apiResponse: SetupStatusResponse = {
          step: 'finished',
          setup_at: setupDate,
        }
        mockSetupStatus.mockResolvedValue(apiResponse)

        const result = await fetchSetupStatusWithCache()

        expect(result).toEqual(apiResponse)
        expect(result.setup_at).toEqual(setupDate)
      })

      it('should propagate API errors', async () => {
        const apiError = new Error('Network error')
        mockSetupStatus.mockRejectedValue(apiError)

        await expect(fetchSetupStatusWithCache()).rejects.toThrow('Network error')
      })

      it('should not update cache when API call fails', async () => {
        mockSetupStatus.mockRejectedValue(new Error('API error'))

        await expect(fetchSetupStatusWithCache()).rejects.toThrow()

        expect(localStorage.getItem('setup_status')).toBeNull()
      })
    })
  })
})
