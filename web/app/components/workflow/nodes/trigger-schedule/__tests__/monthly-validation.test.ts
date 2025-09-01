import nodeDefault from '../default'

const mockT = (key: string, options?: any) => {
  const translations: Record<string, string> = {
    'workflow.errorMsg.fieldRequired': `${options?.field} is required`,
    'workflow.nodes.triggerSchedule.monthlyDay': 'Monthly Day',
    'workflow.nodes.triggerSchedule.invalidMonthlyDay': 'Invalid monthly day',
    'workflow.nodes.triggerSchedule.time': 'Time',
    'workflow.nodes.triggerSchedule.invalidTimeFormat': 'Invalid time format',
  }
  return translations[key] || key
}

describe('Monthly Validation', () => {
  describe('Single day validation', () => {
    test('validates single day selection', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
          monthly_days: [15],
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    test('validates last day selection', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
          monthly_days: ['last' as const],
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })
  })

  describe('Multi-day validation', () => {
    test('validates multiple day selection', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
          monthly_days: [1, 15, 30],
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    test('validates mixed selection with last day', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
          monthly_days: [1, 15, 'last' as const],
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    test('rejects empty array', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
          monthly_days: [],
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Monthly Day is required')
    })

    test('rejects invalid day in array', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
          monthly_days: [1, 35, 15],
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid monthly day')
    })
  })

  describe('Edge cases', () => {
    test('requires monthly configuration', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Monthly Day is required')
    })

    test('validates time format along with monthly_days', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: 'invalid-time',
          monthly_days: [1, 15],
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid time format')
    })

    test('handles very large arrays', () => {
      const config = {
        mode: 'visual' as const,
        frequency: 'monthly' as const,
        visual_config: {
          time: '10:30 AM',
          monthly_days: Array.from({ length: 31 }, (_, i) => i + 1),
        },
        timezone: 'UTC',
      }

      const result = nodeDefault.checkValid(config, mockT)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })
  })
})
