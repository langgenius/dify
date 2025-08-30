/**
 * MAX_PARALLEL_LIMIT Configuration Bug Test
 *
 * This test reproduces and verifies the fix for issue #23083:
 * MAX_PARALLEL_LIMIT environment variable does not take effect in iteration panel
 */

import { render, screen } from '@testing-library/react'
import React from 'react'

// Mock environment variables before importing constants
const originalEnv = process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT

// Test with different environment values
function setupEnvironment(value?: string) {
  if (value)
    process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT = value
  else
    delete process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT

  // Clear module cache to force re-evaluation
  jest.resetModules()
}

function restoreEnvironment() {
  if (originalEnv)
    process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT = originalEnv
  else
    delete process.env.NEXT_PUBLIC_MAX_PARALLEL_LIMIT

  jest.resetModules()
}

// Mock i18next with proper implementation
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key.includes('MaxParallelismTitle')) return 'Max Parallelism'
      if (key.includes('MaxParallelismDesc')) return 'Maximum number of parallel executions'
      if (key.includes('parallelMode')) return 'Parallel Mode'
      if (key.includes('parallelPanelDesc')) return 'Enable parallel execution'
      if (key.includes('errorResponseMethod')) return 'Error Response Method'
      return key
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}))

// Mock i18next module completely to prevent initialization issues
jest.mock('i18next', () => ({
  use: jest.fn().mockReturnThis(),
  init: jest.fn().mockReturnThis(),
  t: jest.fn(key => key),
  isInitialized: true,
}))

// Mock the useConfig hook
jest.mock('@/app/components/workflow/nodes/iteration/use-config', () => ({
  __esModule: true,
  default: () => ({
    inputs: {
      is_parallel: true,
      parallel_nums: 5,
      error_handle_mode: 'terminated',
    },
    changeParallel: jest.fn(),
    changeParallelNums: jest.fn(),
    changeErrorHandleMode: jest.fn(),
  }),
}))

// Mock other components
jest.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => {
  return function MockVarReferencePicker() {
    return <div data-testid="var-reference-picker">VarReferencePicker</div>
  }
})

jest.mock('@/app/components/workflow/nodes/_base/components/split', () => {
  return function MockSplit() {
    return <div data-testid="split">Split</div>
  }
})

jest.mock('@/app/components/workflow/nodes/_base/components/field', () => {
  return function MockField({ title, children }: { title: string, children: React.ReactNode }) {
    return (
      <div data-testid="field">
        <label>{title}</label>
        {children}
      </div>
    )
  }
})

jest.mock('@/app/components/base/switch', () => {
  return function MockSwitch({ defaultValue }: { defaultValue: boolean }) {
    return <input type="checkbox" defaultChecked={defaultValue} data-testid="switch" />
  }
})

jest.mock('@/app/components/base/select', () => {
  return function MockSelect() {
    return <select data-testid="select">Select</select>
  }
})

// Use defaultValue to avoid controlled input warnings
jest.mock('@/app/components/base/slider', () => {
  return function MockSlider({ value, max, min }: { value: number, max: number, min: number }) {
    return (
      <input
        type="range"
        defaultValue={value}
        max={max}
        min={min}
        data-testid="slider"
        data-max={max}
        data-min={min}
        readOnly
      />
    )
  }
})

// Use defaultValue to avoid controlled input warnings
jest.mock('@/app/components/base/input', () => {
  return function MockInput({ type, max, min, value }: { type: string, max: number, min: number, value: number }) {
    return (
      <input
        type={type}
        defaultValue={value}
        max={max}
        min={min}
        data-testid="number-input"
        data-max={max}
        data-min={min}
        readOnly
      />
    )
  }
})

describe('MAX_PARALLEL_LIMIT Configuration Bug', () => {
  const mockNodeData = {
    id: 'test-iteration-node',
    type: 'iteration' as const,
    data: {
      title: 'Test Iteration',
      desc: 'Test iteration node',
      iterator_selector: ['test'],
      output_selector: ['output'],
      is_parallel: true,
      parallel_nums: 5,
      error_handle_mode: 'terminated' as const,
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    restoreEnvironment()
  })

  afterAll(() => {
    restoreEnvironment()
  })

  describe('Environment Variable Parsing', () => {
    it('should parse MAX_PARALLEL_LIMIT from NEXT_PUBLIC_MAX_PARALLEL_LIMIT environment variable', () => {
      setupEnvironment('25')
      const { MAX_PARALLEL_LIMIT } = require('@/config')
      expect(MAX_PARALLEL_LIMIT).toBe(25)
    })

    it('should fallback to default when environment variable is not set', () => {
      setupEnvironment() // No environment variable
      const { MAX_PARALLEL_LIMIT } = require('@/config')
      expect(MAX_PARALLEL_LIMIT).toBe(10)
    })

    it('should handle invalid environment variable values', () => {
      setupEnvironment('invalid')
      const { MAX_PARALLEL_LIMIT } = require('@/config')

      // Should fall back to default when parsing fails
      expect(MAX_PARALLEL_LIMIT).toBe(10)
    })

    it('should handle empty environment variable', () => {
      setupEnvironment('')
      const { MAX_PARALLEL_LIMIT } = require('@/config')

      // Should fall back to default when empty
      expect(MAX_PARALLEL_LIMIT).toBe(10)
    })

    // Edge cases for boundary values
    it('should clamp MAX_PARALLEL_LIMIT to MIN when env is 0 or negative', () => {
      setupEnvironment('0')
      let { MAX_PARALLEL_LIMIT } = require('@/config')
      expect(MAX_PARALLEL_LIMIT).toBe(10) // Falls back to default

      setupEnvironment('-5')
      ;({ MAX_PARALLEL_LIMIT } = require('@/config'))
      expect(MAX_PARALLEL_LIMIT).toBe(10) // Falls back to default
    })

    it('should handle float numbers by parseInt behavior', () => {
      setupEnvironment('12.7')
      const { MAX_PARALLEL_LIMIT } = require('@/config')
      // parseInt truncates to integer
      expect(MAX_PARALLEL_LIMIT).toBe(12)
    })
  })

  describe('UI Component Integration (Main Fix Verification)', () => {
    it('should render iteration panel with environment-configured max value', () => {
      // Set environment variable to a different value
      setupEnvironment('30')

      // Import Panel after setting environment
      const Panel = require('@/app/components/workflow/nodes/iteration/panel').default
      const { MAX_PARALLEL_LIMIT } = require('@/config')

      render(
        <Panel
          id="test-node"
          data={mockNodeData.data}
        />,
      )

      // Behavior-focused assertion: UI max should equal MAX_PARALLEL_LIMIT
      const numberInput = screen.getByTestId('number-input')
      expect(numberInput).toHaveAttribute('data-max', String(MAX_PARALLEL_LIMIT))

      const slider = screen.getByTestId('slider')
      expect(slider).toHaveAttribute('data-max', String(MAX_PARALLEL_LIMIT))

      // Verify the actual values
      expect(MAX_PARALLEL_LIMIT).toBe(30)
      expect(numberInput.getAttribute('data-max')).toBe('30')
      expect(slider.getAttribute('data-max')).toBe('30')
    })

    it('should maintain UI consistency with different environment values', () => {
      setupEnvironment('15')
      const Panel = require('@/app/components/workflow/nodes/iteration/panel').default
      const { MAX_PARALLEL_LIMIT } = require('@/config')

      render(
        <Panel
          id="test-node"
          data={mockNodeData.data}
        />,
      )

      // Both input and slider should use the same max value from MAX_PARALLEL_LIMIT
      const numberInput = screen.getByTestId('number-input')
      const slider = screen.getByTestId('slider')

      expect(numberInput.getAttribute('data-max')).toBe(slider.getAttribute('data-max'))
      expect(numberInput.getAttribute('data-max')).toBe(String(MAX_PARALLEL_LIMIT))
    })
  })

  describe('Legacy Constant Verification (For Transition Period)', () => {
    // Marked as transition/deprecation tests
    it('should maintain MAX_ITERATION_PARALLEL_NUM for backward compatibility', () => {
      const { MAX_ITERATION_PARALLEL_NUM } = require('@/app/components/workflow/constants')
      expect(typeof MAX_ITERATION_PARALLEL_NUM).toBe('number')
      expect(MAX_ITERATION_PARALLEL_NUM).toBe(10) // Hardcoded legacy value
    })

    it('should demonstrate MAX_PARALLEL_LIMIT vs legacy constant difference', () => {
      setupEnvironment('50')
      const { MAX_PARALLEL_LIMIT } = require('@/config')
      const { MAX_ITERATION_PARALLEL_NUM } = require('@/app/components/workflow/constants')

      // MAX_PARALLEL_LIMIT is configurable, MAX_ITERATION_PARALLEL_NUM is not
      expect(MAX_PARALLEL_LIMIT).toBe(50)
      expect(MAX_ITERATION_PARALLEL_NUM).toBe(10)
      expect(MAX_PARALLEL_LIMIT).not.toBe(MAX_ITERATION_PARALLEL_NUM)
    })
  })

  describe('Constants Validation', () => {
    it('should validate that required constants exist and have correct types', () => {
      const { MAX_PARALLEL_LIMIT } = require('@/config')
      const { MIN_ITERATION_PARALLEL_NUM } = require('@/app/components/workflow/constants')
      expect(typeof MAX_PARALLEL_LIMIT).toBe('number')
      expect(typeof MIN_ITERATION_PARALLEL_NUM).toBe('number')
      expect(MAX_PARALLEL_LIMIT).toBeGreaterThanOrEqual(MIN_ITERATION_PARALLEL_NUM)
    })
  })
})
