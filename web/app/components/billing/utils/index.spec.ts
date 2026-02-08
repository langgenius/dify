import type { CurrentPlanInfoBackend } from '../type'
import { DocumentProcessingPriority, Plan } from '../type'
import { getPlanVectorSpaceLimitMB, parseCurrentPlan, parseVectorSpaceToMB } from './index'

describe('billing utils', () => {
  // parseVectorSpaceToMB tests
  describe('parseVectorSpaceToMB', () => {
    it('should parse MB values correctly', () => {
      expect(parseVectorSpaceToMB('50MB')).toBe(50)
      expect(parseVectorSpaceToMB('100MB')).toBe(100)
    })

    it('should parse GB values and convert to MB', () => {
      expect(parseVectorSpaceToMB('5GB')).toBe(5 * 1024)
      expect(parseVectorSpaceToMB('20GB')).toBe(20 * 1024)
    })

    it('should be case insensitive', () => {
      expect(parseVectorSpaceToMB('50mb')).toBe(50)
      expect(parseVectorSpaceToMB('5gb')).toBe(5 * 1024)
    })

    it('should return 0 for invalid format', () => {
      expect(parseVectorSpaceToMB('50')).toBe(0)
      expect(parseVectorSpaceToMB('invalid')).toBe(0)
      expect(parseVectorSpaceToMB('')).toBe(0)
      expect(parseVectorSpaceToMB('50TB')).toBe(0)
    })
  })

  // getPlanVectorSpaceLimitMB tests
  describe('getPlanVectorSpaceLimitMB', () => {
    it('should return correct vector space for sandbox plan', () => {
      expect(getPlanVectorSpaceLimitMB(Plan.sandbox)).toBe(50)
    })

    it('should return correct vector space for professional plan', () => {
      expect(getPlanVectorSpaceLimitMB(Plan.professional)).toBe(5 * 1024)
    })

    it('should return correct vector space for team plan', () => {
      expect(getPlanVectorSpaceLimitMB(Plan.team)).toBe(20 * 1024)
    })

    it('should return 0 for invalid plan', () => {
      // @ts-expect-error - Testing invalid plan input
      expect(getPlanVectorSpaceLimitMB('invalid')).toBe(0)
    })
  })

  // parseCurrentPlan tests
  describe('parseCurrentPlan', () => {
    const createMockPlanData = (overrides: Partial<CurrentPlanInfoBackend> = {}): CurrentPlanInfoBackend => ({
      billing: {
        enabled: true,
        subscription: {
          plan: Plan.sandbox,
        },
      },
      members: {
        size: 1,
        limit: 1,
      },
      apps: {
        size: 2,
        limit: 5,
      },
      vector_space: {
        size: 10,
        limit: 50,
      },
      annotation_quota_limit: {
        size: 5,
        limit: 10,
      },
      documents_upload_quota: {
        size: 20,
        limit: 0,
      },
      docs_processing: DocumentProcessingPriority.standard,
      can_replace_logo: false,
      model_load_balancing_enabled: false,
      dataset_operator_enabled: false,
      education: {
        enabled: false,
        activated: false,
      },
      webapp_copyright_enabled: false,
      workspace_members: {
        size: 1,
        limit: 1,
      },
      is_allow_transfer_workspace: false,
      knowledge_pipeline: {
        publish_enabled: false,
      },
      ...overrides,
    })

    it('should parse plan type correctly', () => {
      const data = createMockPlanData()
      const result = parseCurrentPlan(data)
      expect(result.type).toBe(Plan.sandbox)
    })

    it('should parse usage values correctly', () => {
      const data = createMockPlanData()
      const result = parseCurrentPlan(data)

      expect(result.usage.vectorSpace).toBe(10)
      expect(result.usage.buildApps).toBe(2)
      expect(result.usage.teamMembers).toBe(1)
      expect(result.usage.annotatedResponse).toBe(5)
      expect(result.usage.documentsUploadQuota).toBe(20)
    })

    it('should parse total limits correctly', () => {
      const data = createMockPlanData()
      const result = parseCurrentPlan(data)

      expect(result.total.vectorSpace).toBe(50)
      expect(result.total.buildApps).toBe(5)
      expect(result.total.teamMembers).toBe(1)
      expect(result.total.annotatedResponse).toBe(10)
    })

    it('should convert 0 limits to NUM_INFINITE (-1)', () => {
      const data = createMockPlanData({
        documents_upload_quota: {
          size: 20,
          limit: 0,
        },
      })
      const result = parseCurrentPlan(data)
      expect(result.total.documentsUploadQuota).toBe(-1)
    })

    it('should handle api_rate_limit quota', () => {
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: null,
        },
      })
      const result = parseCurrentPlan(data)

      expect(result.usage.apiRateLimit).toBe(100)
      expect(result.total.apiRateLimit).toBe(5000)
    })

    it('should handle trigger_event quota', () => {
      const data = createMockPlanData({
        trigger_event: {
          usage: 50,
          limit: 3000,
          reset_date: null,
        },
      })
      const result = parseCurrentPlan(data)

      expect(result.usage.triggerEvents).toBe(50)
      expect(result.total.triggerEvents).toBe(3000)
    })

    it('should use fallback for api_rate_limit when not provided', () => {
      const data = createMockPlanData()
      const result = parseCurrentPlan(data)

      // Fallback to plan preset value for sandbox: 5000
      expect(result.total.apiRateLimit).toBe(5000)
    })

    it('should convert 0 or -1 rate limits to NUM_INFINITE', () => {
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 0,
          limit: 0,
          reset_date: null,
        },
      })
      const result = parseCurrentPlan(data)
      expect(result.total.apiRateLimit).toBe(-1)

      const data2 = createMockPlanData({
        api_rate_limit: {
          usage: 0,
          limit: -1,
          reset_date: null,
        },
      })
      const result2 = parseCurrentPlan(data2)
      expect(result2.total.apiRateLimit).toBe(-1)
    })

    it('should handle reset dates with milliseconds timestamp', () => {
      const futureDate = Date.now() + 86400000 // Tomorrow in ms
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: futureDate,
        },
      })
      const result = parseCurrentPlan(data)

      expect(result.reset.apiRateLimit).toBe(1)
    })

    it('should handle reset dates with seconds timestamp', () => {
      const futureDate = Math.floor(Date.now() / 1000) + 86400 // Tomorrow in seconds
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: futureDate,
        },
      })
      const result = parseCurrentPlan(data)

      expect(result.reset.apiRateLimit).toBe(1)
    })

    it('should handle reset dates in YYYYMMDD format', () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const year = tomorrow.getFullYear()
      const month = String(tomorrow.getMonth() + 1).padStart(2, '0')
      const day = String(tomorrow.getDate()).padStart(2, '0')
      const dateNumber = Number.parseInt(`${year}${month}${day}`, 10)

      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: dateNumber,
        },
      })
      const result = parseCurrentPlan(data)

      expect(result.reset.apiRateLimit).toBe(1)
    })

    it('should return null for invalid reset dates', () => {
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: 0,
        },
      })
      const result = parseCurrentPlan(data)
      expect(result.reset.apiRateLimit).toBeNull()
    })

    it('should return null for negative reset dates', () => {
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: -1,
        },
      })
      const result = parseCurrentPlan(data)
      expect(result.reset.apiRateLimit).toBeNull()
    })

    it('should return null when reset date is in the past', () => {
      const pastDate = Date.now() - 86400000 // Yesterday
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: pastDate,
        },
      })
      const result = parseCurrentPlan(data)
      expect(result.reset.apiRateLimit).toBeNull()
    })

    it('should handle missing apps field', () => {
      const data = createMockPlanData()
      // @ts-expect-error - Testing edge case
      delete data.apps
      const result = parseCurrentPlan(data)
      expect(result.usage.buildApps).toBe(0)
    })

    it('should return null for unrecognized date format', () => {
      const data = createMockPlanData({
        api_rate_limit: {
          usage: 100,
          limit: 5000,
          reset_date: 12345, // Unrecognized format
        },
      })
      const result = parseCurrentPlan(data)
      expect(result.reset.apiRateLimit).toBeNull()
    })
  })
})
