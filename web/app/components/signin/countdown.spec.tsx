import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Countdown, { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from './countdown'

// Mock useCountDown from ahooks
let mockTime = COUNT_DOWN_TIME_MS
let mockOnEnd: (() => void) | undefined

vi.mock('ahooks', () => ({
  useCountDown: ({ onEnd }: { leftTime: number, onEnd?: () => void }) => {
    mockOnEnd = onEnd
    return [mockTime]
  },
}))

describe('Countdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTime = COUNT_DOWN_TIME_MS
    mockOnEnd = undefined
    localStorage.clear()
  })

  // Rendering Tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Countdown />)
      expect(screen.getByText('login.checkCode.didNotReceiveCode')).toBeInTheDocument()
    })

    it('should display countdown time when time > 0', () => {
      mockTime = 30000 // 30 seconds
      render(<Countdown />)

      // The countdown displays number and 's' in the same span
      expect(screen.getByText(/30/)).toBeInTheDocument()
      expect(screen.getByText(/s$/)).toBeInTheDocument()
    })

    it('should display resend link when time <= 0', () => {
      mockTime = 0
      render(<Countdown />)

      expect(screen.getByText('login.checkCode.resend')).toBeInTheDocument()
      expect(screen.queryByText('s')).not.toBeInTheDocument()
    })

    it('should not display resend link when time > 0', () => {
      mockTime = 1000
      render(<Countdown />)

      expect(screen.queryByText('login.checkCode.resend')).not.toBeInTheDocument()
    })
  })

  // State Management Tests
  describe('State Management', () => {
    it('should initialize leftTime from localStorage if available', () => {
      const savedTime = 45000
      vi.mocked(localStorage.getItem).mockReturnValueOnce(String(savedTime))

      render(<Countdown />)

      expect(localStorage.getItem).toHaveBeenCalledWith(COUNT_DOWN_KEY)
    })

    it('should use default COUNT_DOWN_TIME_MS when localStorage is empty', () => {
      vi.mocked(localStorage.getItem).mockReturnValueOnce(null)

      render(<Countdown />)

      expect(localStorage.getItem).toHaveBeenCalledWith(COUNT_DOWN_KEY)
    })

    it('should save time to localStorage on time change', () => {
      mockTime = 50000
      render(<Countdown />)

      expect(localStorage.setItem).toHaveBeenCalledWith(COUNT_DOWN_KEY, String(mockTime))
    })
  })

  // Event Handler Tests
  describe('Event Handlers', () => {
    it('should call onResend callback when resend is clicked', () => {
      mockTime = 0
      const onResend = vi.fn()

      render(<Countdown onResend={onResend} />)

      const resendLink = screen.getByText('login.checkCode.resend')
      fireEvent.click(resendLink)

      expect(onResend).toHaveBeenCalledTimes(1)
    })

    it('should reset countdown when resend is clicked', () => {
      mockTime = 0

      render(<Countdown />)

      const resendLink = screen.getByText('login.checkCode.resend')
      fireEvent.click(resendLink)

      expect(localStorage.setItem).toHaveBeenCalledWith(COUNT_DOWN_KEY, String(COUNT_DOWN_TIME_MS))
    })

    it('should work without onResend callback (optional prop)', () => {
      mockTime = 0

      render(<Countdown />)

      const resendLink = screen.getByText('login.checkCode.resend')
      expect(() => fireEvent.click(resendLink)).not.toThrow()
    })
  })

  // Countdown End Tests
  describe('Countdown End', () => {
    it('should remove localStorage item when countdown ends', () => {
      render(<Countdown />)

      // Simulate countdown end
      act(() => {
        mockOnEnd?.()
      })

      expect(localStorage.removeItem).toHaveBeenCalledWith(COUNT_DOWN_KEY)
    })
  })

  // Edge Cases
  describe('Edge Cases', () => {
    it('should handle time exactly at 0', () => {
      mockTime = 0
      render(<Countdown />)

      expect(screen.getByText('login.checkCode.resend')).toBeInTheDocument()
    })

    it('should handle negative time values', () => {
      mockTime = -1000
      render(<Countdown />)

      expect(screen.getByText('login.checkCode.resend')).toBeInTheDocument()
    })

    it('should round time display correctly', () => {
      mockTime = 29500 // Should display as 30 (Math.round)
      render(<Countdown />)

      expect(screen.getByText(/30/)).toBeInTheDocument()
    })

    it('should display 1 second correctly', () => {
      mockTime = 1000
      render(<Countdown />)

      expect(screen.getByText(/^1/)).toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    it('should render correctly with onResend prop', () => {
      const onResend = vi.fn()
      mockTime = 0

      render(<Countdown onResend={onResend} />)

      expect(screen.getByText('login.checkCode.resend')).toBeInTheDocument()
    })

    it('should render correctly without any props', () => {
      render(<Countdown />)

      expect(screen.getByText('login.checkCode.didNotReceiveCode')).toBeInTheDocument()
    })
  })

  // Exported Constants
  describe('Exported Constants', () => {
    it('should export COUNT_DOWN_TIME_MS as 59000', () => {
      expect(COUNT_DOWN_TIME_MS).toBe(59000)
    })

    it('should export COUNT_DOWN_KEY as leftTime', () => {
      expect(COUNT_DOWN_KEY).toBe('leftTime')
    })
  })
})
