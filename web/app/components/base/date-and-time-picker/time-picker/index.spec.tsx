import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import TimePicker from './index'
import dayjs from '../utils/dayjs'
import { isDayjsObject } from '../utils/dayjs'
import type { TimePickerProps } from '../types'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'time.defaultPlaceholder') return 'Pick a time...'
      if (key === 'time.operation.now') return 'Now'
      if (key === 'time.operation.ok') return 'OK'
      if (key === 'common.operation.clear') return 'Clear'
      return key
    },
  }),
}))

jest.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: (e: React.MouseEvent) => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="timepicker-content">{children}</div>
  ),
}))

jest.mock('./options', () => () => <div data-testid="time-options" />)
jest.mock('./header', () => () => <div data-testid="time-header" />)
jest.mock('@/app/components/base/timezone-label', () => {
  return function MockTimezoneLabel({ timezone, inline, className }: { timezone: string, inline?: boolean, className?: string }) {
    return (
      <span data-testid="timezone-label" data-timezone={timezone} data-inline={inline} className={className}>
        UTC+8
      </span>
    )
  }
})

describe('TimePicker', () => {
  const baseProps: Pick<TimePickerProps, 'onChange' | 'onClear' | 'value'> = {
    onChange: jest.fn(),
    onClear: jest.fn(),
    value: undefined,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders formatted value for string input (Issue #26692 regression)', () => {
    render(
      <TimePicker
        {...baseProps}
        value="18:45"
        timezone="UTC"
      />,
    )

    expect(screen.getByDisplayValue('06:45 PM')).toBeInTheDocument()
  })

  test('confirms cleared value when confirming without selection', () => {
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

  test('selecting current time emits timezone-aware value', () => {
    const onChange = jest.fn()
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
    test('should not display timezone label by default', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
        />,
      )

      expect(screen.queryByTestId('timezone-label')).not.toBeInTheDocument()
    })

    test('should not display timezone label when showTimezone is false', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
          showTimezone={false}
        />,
      )

      expect(screen.queryByTestId('timezone-label')).not.toBeInTheDocument()
    })

    test('should display timezone label when showTimezone is true', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Asia/Shanghai"
          showTimezone={true}
        />,
      )

      const timezoneLabel = screen.getByTestId('timezone-label')
      expect(timezoneLabel).toBeInTheDocument()
      expect(timezoneLabel).toHaveAttribute('data-timezone', 'Asia/Shanghai')
    })

    test('should pass inline prop to timezone label', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="America/New_York"
          showTimezone={true}
        />,
      )

      const timezoneLabel = screen.getByTestId('timezone-label')
      expect(timezoneLabel).toHaveAttribute('data-inline', 'true')
    })

    test('should not display timezone label when showTimezone is true but timezone is not provided', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          showTimezone={true}
        />,
      )

      expect(screen.queryByTestId('timezone-label')).not.toBeInTheDocument()
    })

    test('should apply shrink-0 and text-xs classes to timezone label', () => {
      render(
        <TimePicker
          {...baseProps}
          value="12:00 AM"
          timezone="Europe/London"
          showTimezone={true}
        />,
      )

      const timezoneLabel = screen.getByTestId('timezone-label')
      expect(timezoneLabel).toHaveClass('shrink-0', 'text-xs')
    })
  })
})
