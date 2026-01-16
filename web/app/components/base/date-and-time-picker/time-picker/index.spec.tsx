import type { TimePickerProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import dayjs, { isDayjsObject } from '../utils/dayjs'
import TimePicker from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      if (key === 'defaultPlaceholder')
        return 'Pick a time...'
      if (key === 'operation.now')
        return 'Now'
      if (key === 'operation.ok')
        return 'OK'
      if (key === 'operation.clear')
        return 'Clear'
      const prefix = options?.ns ? `${options.ns}.` : ''
      return `${prefix}${key}`
    },
  }),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: (e: React.MouseEvent) => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="timepicker-content">{children}</div>
  ),
}))

vi.mock('./options', () => ({
  default: () => <div data-testid="time-options" />,
}))
vi.mock('./header', () => ({
  default: () => <div data-testid="time-header" />,
}))

describe('TimePicker', () => {
  const baseProps: Pick<TimePickerProps, 'onChange' | 'onClear' | 'value'> = {
    onChange: vi.fn(),
    onClear: vi.fn(),
    value: undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders formatted value for string input (Issue #26692 regression)', () => {
    render(
      <TimePicker
        {...baseProps}
        value="18:45"
        timezone="UTC"
      />,
    )

    expect(screen.getByDisplayValue('06:45 PM')).toBeInTheDocument()
  })

  it('confirms cleared value when confirming without selection', () => {
    render(
      <TimePicker
        {...baseProps}
        value={dayjs('2024-01-01T03:30:00Z')}
        timezone="UTC"
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.click(input)

    const clearButton = screen.getByRole('button', { name: /clear/i })
    fireEvent.click(clearButton)

    const confirmButton = screen.getByRole('button', { name: 'OK' })
    fireEvent.click(confirmButton)

    expect(baseProps.onChange).toHaveBeenCalledTimes(1)
    expect(baseProps.onChange).toHaveBeenCalledWith(undefined)
    expect(baseProps.onClear).not.toHaveBeenCalled()
  })

  it('selecting current time emits timezone-aware value', () => {
    const onChange = vi.fn()
    render(
      <TimePicker
        {...baseProps}
        onChange={onChange}
        timezone="America/New_York"
      />,
    )

    const nowButton = screen.getByRole('button', { name: 'Now' })
    fireEvent.click(nowButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    const emitted = onChange.mock.calls[0][0]
    expect(isDayjsObject(emitted)).toBe(true)
    expect(emitted?.utcOffset()).toBe(dayjs().tz('America/New_York').utcOffset())
  })

  describe('Timezone Label Integration', () => {
    it('should not display timezone label by default', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
        />,
      )

      expect(screen.queryByTitle(/Timezone: Asia\/Shanghai/)).not.toBeInTheDocument()
    })

    it('should not display timezone label when showTimezone is false', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
          showTimezone={false}
        />,
      )

      expect(screen.queryByTitle(/Timezone: Asia\/Shanghai/)).not.toBeInTheDocument()
    })

    it('should display timezone label when showTimezone is true', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
          showTimezone={true}
        />,
      )

      const timezoneLabel = screen.getByTitle(/Timezone: Asia\/Shanghai/)
      expect(timezoneLabel).toBeInTheDocument()
      expect(timezoneLabel).toHaveTextContent(/UTC[+-]\d+/)
    })

    it('should not display timezone label when showTimezone is true but timezone is not provided', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          showTimezone={true}
        />,
      )

      expect(screen.queryByTitle(/Timezone:/)).not.toBeInTheDocument()
    })
  })
})
