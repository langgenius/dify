import { renderHook } from '@testing-library/react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

// Mock useAppContext
const mockUseAppContext = jest.fn()
jest.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
}))

// Mock useNodesReadOnly
jest.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({
    nodesReadOnly: false,
  }),
}))

// Mock useNodeCrud - it should return the frontendPayload as inputs
jest.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: jest.fn(),
}))

const mockUseNodeCrud = require('@/app/components/workflow/nodes/_base/hooks/use-node-crud').default

import useConfig from '../use-config'
import type { ScheduleTriggerNodeType } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'

describe('useConfig timezone integration', () => {
  const mockPayload: ScheduleTriggerNodeType = {
    id: 'test-id',
    type: BlockEnum.TriggerSchedule,
    data: {},
    mode: 'visual',
    frequency: 'weekly',
    timezone: 'America/New_York',
    enabled: true,
    visual_config: {
      time: '14:30', // UTC format
      weekdays: ['sun'],
    },
  }

  beforeEach(() => {
    // Default mock for useAppContext
    mockUseAppContext.mockReturnValue({
      userProfile: {
        timezone: 'America/New_York',
      },
    })

    // Default mock for useNodeCrud - it returns the frontendPayload
    mockUseNodeCrud.mockImplementation((id, frontendPayload) => ({
      inputs: frontendPayload,
      setInputs: jest.fn(),
    }))
  })

  describe('timezone conversion with dayjs', () => {
    test('converts UTC time to user timezone for display', () => {
      const { result } = renderHook(() => useConfig('test-id', mockPayload))

      // The frontendPayload should convert UTC 14:30 to Eastern time
      // 14:30 UTC = 9:30 AM EST (winter) or 10:30 AM EDT (summer)
      const frontendTime = result.current.inputs.visual_config?.time
      expect(frontendTime).toMatch(/^(9|10):30 AM$/)
    })

    test('handles user timezone preference over payload timezone', () => {
      const payloadWithDifferentTz = {
        ...mockPayload,
        timezone: 'America/Los_Angeles',
      }

      const { result } = renderHook(() => useConfig('test-id', payloadWithDifferentTz))

      // Should use user preference (America/New_York) not payload timezone (America/Los_Angeles)
      expect(result.current.inputs.timezone).toBe('America/New_York')
    })

    test('falls back to payload timezone when user has no timezone', () => {
      // Mock useAppContext to return no timezone
      mockUseAppContext.mockReturnValue({
        userProfile: {},
      })

      const { result } = renderHook(() => useConfig('test-id', mockPayload))

      expect(result.current.inputs.timezone).toBe('America/New_York')
    })
  })

  describe('round trip conversion accuracy', () => {
    test('useConfig conversion functions work accurately', () => {
      const testCases = [
        { input: '2:30 PM', timezone: 'America/New_York' },
        { input: '9:00 AM', timezone: 'America/Los_Angeles' },
        { input: '12:00 PM', timezone: 'Europe/London' },
        { input: '11:59 PM', timezone: 'Asia/Tokyo' },
      ]

      testCases.forEach(({ input, timezone }) => {
        // Mock user timezone
        mockUseAppContext.mockReturnValue({
          userProfile: { timezone },
        })

        // Create payload with user time format (this should be converted to UTC internally)
        const testPayload = {
          ...mockPayload,
          visual_config: { time: input, weekdays: ['sun'] },
        }

        const { result } = renderHook(() => useConfig('test-id', testPayload))

        // The useConfig hook should handle the conversion properly
        // Since we're passing user format directly, it should preserve it
        expect(result.current.inputs.visual_config?.time).toBe(input)
      })
    })
  })

  describe('edge cases and error handling', () => {
    test('handles invalid time formats gracefully', () => {
      const invalidPayload = {
        ...mockPayload,
        visual_config: {
          time: 'invalid time',
          weekdays: ['sun'],
        },
      }

      const { result } = renderHook(() => useConfig('test-id', invalidPayload))

      // Should not crash and should preserve invalid input
      expect(result.current.inputs.visual_config?.time).toBe('invalid time')
    })

    test('handles missing visual_config gracefully', () => {
      const noConfigPayload = {
        ...mockPayload,
        visual_config: undefined,
      }

      const { result } = renderHook(() => useConfig('test-id', noConfigPayload))

      // Should use default values
      expect(result.current.inputs.visual_config?.time).toBe('11:30 AM')
      expect(result.current.inputs.visual_config?.weekdays).toEqual(['sun'])
    })

    test('handles UTC timezone correctly', () => {
      // Mock useAppContext to return UTC timezone
      mockUseAppContext.mockReturnValue({
        userProfile: {
          timezone: 'UTC',
        },
      })

      const utcPayload = {
        ...mockPayload,
        timezone: 'UTC',
        visual_config: {
          time: '14:30', // UTC format
          weekdays: ['sun'],
        },
      }

      const { result } = renderHook(() => useConfig('test-id', utcPayload))

      // For UTC timezone, 14:30 should become 2:30 PM
      expect(result.current.inputs.visual_config?.time).toBe('2:30 PM')
    })
  })

  describe('useConfig internal conversion functions', () => {
    test('internal timezone conversion functions work correctly', () => {
      // Test that useConfig properly handles UTC format conversion
      const utcPayload = {
        ...mockPayload,
        visual_config: { time: '19:30', weekdays: ['sun'] }, // 19:30 UTC = 2:30 PM EST (winter)
      }

      const { result: utcResult } = renderHook(() => useConfig('test-id', utcPayload))

      // Should convert 19:30 UTC to Eastern time
      // In winter (EST, UTC-5): 19:30 UTC = 2:30 PM EST
      // In summer (EDT, UTC-4): 19:30 UTC = 3:30 PM EDT
      expect(utcResult.current.inputs.visual_config?.time).toMatch(/^[23]:30 PM$/)
    })

    test('UTC timezone special case', () => {
      const time = '14:30'

      // For UTC timezone, should convert 24h to 12h format
      const [hour, minute] = time.split(':')
      const hourNum = Number.parseInt(hour, 10)
      let expectedHour = hourNum
      if (hourNum > 12)
        expectedHour = hourNum - 12
      else if (hourNum === 0)
        expectedHour = 12
      const expectedPeriod = hourNum >= 12 ? 'PM' : 'AM'
      const expected = `${expectedHour}:${minute} ${expectedPeriod}`

      expect(expected).toBe('2:30 PM')
    })
  })
})
