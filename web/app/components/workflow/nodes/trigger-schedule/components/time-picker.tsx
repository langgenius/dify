import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiTimeLine } from '@remixicon/react'

const scrollbarHideStyles = {
  scrollbarWidth: 'none' as const,
  msOverflowStyle: 'none' as const,
} as React.CSSProperties

type TimePickerProps = {
  value?: string
  onChange: (time: string) => void
}

const TimePicker = ({ value = '11:30 AM', onChange }: TimePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedHour, setSelectedHour] = useState(11)
  const [selectedMinute, setSelectedMinute] = useState(30)
  const [selectedPeriod, setSelectedPeriod] = useState<'AM' | 'PM'>('AM')
  const hourContainerRef = useRef<HTMLDivElement>(null)
  const minuteContainerRef = useRef<HTMLDivElement>(null)
  const periodContainerRef = useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (isOpen) {
      if (value) {
        const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/)
        if (match) {
          setSelectedHour(Number.parseInt(match[1], 10))
          setSelectedMinute(Number.parseInt(match[2], 10))
          setSelectedPeriod(match[3] as 'AM' | 'PM')
        }
      }
 else {
        setSelectedHour(11)
        setSelectedMinute(30)
        setSelectedPeriod('AM')
      }
    }
  }, [isOpen, value])

  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (hourContainerRef.current) {
          const selectedHourElement = hourContainerRef.current.querySelector('.bg-state-base-active')
          if (selectedHourElement)
            selectedHourElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }

        if (minuteContainerRef.current) {
          const selectedMinuteElement = minuteContainerRef.current.querySelector('.bg-state-base-active')
          if (selectedMinuteElement)
            selectedMinuteElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }

        if (periodContainerRef.current) {
          const selectedPeriodElement = periodContainerRef.current.querySelector('.bg-state-base-active')
          if (selectedPeriodElement)
            selectedPeriodElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 50)
    }
  }, [isOpen, selectedHour, selectedMinute, selectedPeriod])

  const hours = Array.from({ length: 12 }, (_, i) => i + 1)
  const minutes = Array.from({ length: 60 }, (_, i) => i)
  const periods = ['AM', 'PM'] as const

  // Create padding elements to ensure bottom options can scroll to top
  // Container shows 8 options (h-64), so we need 7 padding elements at bottom
  const createBottomPadding = () => Array.from({ length: 7 }, (_, i) => (
    <div key={`bottom-padding-${i}`} className="pointer-events-none h-8" />
  ))

  const handleNow = () => {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const period = hour >= 12 ? 'PM' : 'AM'
    let displayHour = hour
    if (hour === 0)
      displayHour = 12
     else if (hour > 12)
      displayHour = hour - 12

    const timeString = `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`
    onChange(timeString)
    setIsOpen(false)
  }

  const handleOK = () => {
    const timeString = `${selectedHour}:${selectedMinute.toString().padStart(2, '0')} ${selectedPeriod}`
    onChange(timeString)
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 w-full items-center justify-between rounded-lg bg-components-input-bg-normal px-3 py-1.5 text-sm text-text-secondary hover:bg-components-input-bg-hover"
      >
        <span>{value}</span>
        <RiTimeLine className="h-4 w-4 text-text-tertiary" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 select-none rounded-xl border border-components-panel-border bg-components-panel-bg p-4 shadow-lg">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-text-primary">{t('time.title.pickTime')}</h3>
          </div>

          <div className="mb-4 border-b border-components-panel-border-subtle" />

          <div className="mb-4 flex gap-3">
            {/* Hours */}
            <div className="flex-1">
              <div
                ref={hourContainerRef}
                className="h-64 overflow-y-auto [&::-webkit-scrollbar]:hidden"
                style={scrollbarHideStyles}
                data-testid="hour-selector"
              >
                {hours.map(hour => (
                  <button
                    key={hour}
                    type="button"
                    className={`block w-full rounded-lg px-3 py-1.5 text-center text-sm transition-colors ${
                      selectedHour === hour
                        ? 'bg-state-base-active text-text-primary'
                        : 'text-text-secondary hover:bg-state-base-hover'
                    }`}
                    onClick={() => setSelectedHour(hour)}
                  >
                    {hour}
                  </button>
                ))}
                {createBottomPadding()}
              </div>
            </div>

            {/* Minutes */}
            <div className="flex-1">
              <div
                ref={minuteContainerRef}
                className="h-64 overflow-y-auto [&::-webkit-scrollbar]:hidden"
                style={scrollbarHideStyles}
                data-testid="minute-selector"
              >
                {minutes.map(minute => (
                  <button
                    key={minute}
                    type="button"
                    className={`block w-full rounded-lg px-3 py-1.5 text-center text-sm transition-colors ${
                      selectedMinute === minute
                        ? 'bg-state-base-active text-text-primary'
                        : 'text-text-secondary hover:bg-state-base-hover'
                    }`}
                    onClick={() => setSelectedMinute(minute)}
                  >
                    {minute.toString().padStart(2, '0')}
                  </button>
                ))}
                {createBottomPadding()}
              </div>
            </div>

            {/* AM/PM */}
            <div className="flex-1">
              <div
                ref={periodContainerRef}
                className="h-64 overflow-y-auto [&::-webkit-scrollbar]:hidden"
                style={scrollbarHideStyles}
              >
                {periods.map(period => (
                  <button
                    key={period}
                    type="button"
                    className={`block w-full rounded-lg px-3 py-1.5 text-center text-sm transition-colors ${
                      selectedPeriod === period
                        ? 'bg-state-base-active text-text-primary'
                        : 'text-text-secondary hover:bg-state-base-hover'
                    }`}
                    onClick={() => setSelectedPeriod(period)}
                  >
                    {period}
                  </button>
                ))}
                {createBottomPadding()}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-b border-components-panel-border-subtle" />

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleNow}
              className="flex-1 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-1 text-sm font-medium text-text-accent hover:bg-components-button-secondary-bg-hover"
            >
              {t('common.operation.now')}
            </button>
            <button
              type="button"
              onClick={handleOK}
              className="flex-1 rounded-lg bg-components-button-primary-bg px-3 py-1 text-sm font-medium text-white hover:bg-components-button-primary-bg-hover"
            >
              {t('common.operation.ok')}
            </button>
          </div>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}

export default TimePicker
