import { ALL_PLANS, contactSalesUrl, contractSales, defaultPlan, getStartedWithCommunityUrl, getWithPremiumUrl, NUM_INFINITE, unAvailable } from '../config'
import { Priority } from '../type'

describe('Billing Config', () => {
  describe('Constants', () => {
    it('should define NUM_INFINITE as -1', () => {
      expect(NUM_INFINITE).toBe(-1)
    })

    it('should define contractSales string', () => {
      expect(contractSales).toBe('contractSales')
    })

    it('should define unAvailable string', () => {
      expect(unAvailable).toBe('unAvailable')
    })

    it('should define valid URL constants', () => {
      expect(contactSalesUrl).toMatch(/^https:\/\//)
      expect(getStartedWithCommunityUrl).toMatch(/^https:\/\//)
      expect(getWithPremiumUrl).toMatch(/^https:\/\//)
    })
  })

  describe('ALL_PLANS', () => {
    const requiredFields: (keyof typeof ALL_PLANS.sandbox)[] = [
      'level',
      'price',
      'modelProviders',
      'teamWorkspace',
      'teamMembers',
      'buildApps',
      'documents',
      'vectorSpace',
      'documentsUploadQuota',
      'documentsRequestQuota',
      'apiRateLimit',
      'documentProcessingPriority',
      'messageRequest',
      'triggerEvents',
      'annotatedResponse',
      'logHistory',
    ]

    it.each(['sandbox', 'professional', 'team'] as const)('should have all required fields for %s plan', (planKey) => {
      const plan = ALL_PLANS[planKey]
      for (const field of requiredFields)
        expect(plan[field]).toBeDefined()
    })

    it('should have ascending plan levels: sandbox < professional < team', () => {
      expect(ALL_PLANS.sandbox.level).toBeLessThan(ALL_PLANS.professional.level)
      expect(ALL_PLANS.professional.level).toBeLessThan(ALL_PLANS.team.level)
    })

    it('should have ascending plan prices: sandbox < professional < team', () => {
      expect(ALL_PLANS.sandbox.price).toBeLessThan(ALL_PLANS.professional.price)
      expect(ALL_PLANS.professional.price).toBeLessThan(ALL_PLANS.team.price)
    })

    it('should have sandbox as the free plan', () => {
      expect(ALL_PLANS.sandbox.price).toBe(0)
    })

    it('should have ascending team member limits', () => {
      expect(ALL_PLANS.sandbox.teamMembers).toBeLessThan(ALL_PLANS.professional.teamMembers)
      expect(ALL_PLANS.professional.teamMembers).toBeLessThan(ALL_PLANS.team.teamMembers)
    })

    it('should have ascending document processing priority', () => {
      expect(ALL_PLANS.sandbox.documentProcessingPriority).toBe(Priority.standard)
      expect(ALL_PLANS.professional.documentProcessingPriority).toBe(Priority.priority)
      expect(ALL_PLANS.team.documentProcessingPriority).toBe(Priority.topPriority)
    })

    it('should have unlimited API rate limit for professional and team plans', () => {
      expect(ALL_PLANS.sandbox.apiRateLimit).not.toBe(NUM_INFINITE)
      expect(ALL_PLANS.professional.apiRateLimit).toBe(NUM_INFINITE)
      expect(ALL_PLANS.team.apiRateLimit).toBe(NUM_INFINITE)
    })

    it('should have unlimited log history for professional and team plans', () => {
      expect(ALL_PLANS.professional.logHistory).toBe(NUM_INFINITE)
      expect(ALL_PLANS.team.logHistory).toBe(NUM_INFINITE)
    })

    it('should have unlimited trigger events only for team plan', () => {
      expect(ALL_PLANS.sandbox.triggerEvents).not.toBe(NUM_INFINITE)
      expect(ALL_PLANS.professional.triggerEvents).not.toBe(NUM_INFINITE)
      expect(ALL_PLANS.team.triggerEvents).toBe(NUM_INFINITE)
    })
  })

  describe('defaultPlan', () => {
    it('should default to sandbox plan type', () => {
      expect(defaultPlan.type).toBe('sandbox')
    })

    it('should have usage object with all required fields', () => {
      const { usage } = defaultPlan
      expect(usage).toHaveProperty('documents')
      expect(usage).toHaveProperty('vectorSpace')
      expect(usage).toHaveProperty('buildApps')
      expect(usage).toHaveProperty('teamMembers')
      expect(usage).toHaveProperty('annotatedResponse')
      expect(usage).toHaveProperty('documentsUploadQuota')
      expect(usage).toHaveProperty('apiRateLimit')
      expect(usage).toHaveProperty('triggerEvents')
    })

    it('should have total object with all required fields', () => {
      const { total } = defaultPlan
      expect(total).toHaveProperty('documents')
      expect(total).toHaveProperty('vectorSpace')
      expect(total).toHaveProperty('buildApps')
      expect(total).toHaveProperty('teamMembers')
      expect(total).toHaveProperty('annotatedResponse')
      expect(total).toHaveProperty('documentsUploadQuota')
      expect(total).toHaveProperty('apiRateLimit')
      expect(total).toHaveProperty('triggerEvents')
    })

    it('should use sandbox plan API rate limit and trigger events in total', () => {
      expect(defaultPlan.total.apiRateLimit).toBe(ALL_PLANS.sandbox.apiRateLimit)
      expect(defaultPlan.total.triggerEvents).toBe(ALL_PLANS.sandbox.triggerEvents)
    })

    it('should have reset info with null values', () => {
      expect(defaultPlan.reset.apiRateLimit).toBeNull()
      expect(defaultPlan.reset.triggerEvents).toBeNull()
    })

    it('should have usage values not exceeding totals', () => {
      expect(defaultPlan.usage.documents).toBeLessThanOrEqual(defaultPlan.total.documents)
      expect(defaultPlan.usage.vectorSpace).toBeLessThanOrEqual(defaultPlan.total.vectorSpace)
      expect(defaultPlan.usage.buildApps).toBeLessThanOrEqual(defaultPlan.total.buildApps)
      expect(defaultPlan.usage.teamMembers).toBeLessThanOrEqual(defaultPlan.total.teamMembers)
      expect(defaultPlan.usage.annotatedResponse).toBeLessThanOrEqual(defaultPlan.total.annotatedResponse)
    })
  })
})
