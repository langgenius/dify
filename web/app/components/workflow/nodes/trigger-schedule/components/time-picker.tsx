import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiTimeLine } from '@remixicon/react'

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

  React.useEffect(() => {
    if (value) {
      const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/)
      if (match) {
        setSelectedHour(Number.parseInt(match[1], 10))
        setSelectedMinute(Number.parseInt(match[2], 10))
        setSelectedPeriod(match[3] as 'AM' | 'PM')
      }
    }
  }, [value])

  const hours = Array.from({ length: 12 }, (_, i) => i + 1)
  const commonMinutes = [0, 15, 30, 45]
  const periods = ['AM', 'PM'] as const

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

    setSelectedHour(displayHour)
    setSelectedMinute(Math.round(minute / 15) * 15)
    setSelectedPeriod(period)
  }

  const handleOK = () => {
    const timeString = `${selectedHour}:${selectedMinute.toString().padStart(2, '0')} ${selectedPeriod}`
    onChange(timeString)
    setIsOpen(false)
  }

  const displayTime = `${selectedHour}:${selectedMinute.toString().padStart(2, '0')} ${selectedPeriod}`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
      >
        <span>{displayTime}</span>
        <RiTimeLine className="h-4 w-4 text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="mb-3">
            <h3 className="text-sm font-medium text-gray-900">{t('time.pickTime')}</h3>
          </div>

          <div className="mb-3 border-b border-gray-100" />

          <div className="mb-4 flex gap-2">
            {/* Hours */}
            <div className="flex-1">
              <div className="space-y-1">
                {hours.map(hour => (
                  <button
                    key={hour}
                    type="button"
                    className={`w-full rounded px-2 py-1 text-center text-sm transition-colors ${
                      selectedHour === hour
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedHour(hour)}
                  >
                    {hour}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutes */}
            <div className="flex-1">
              <div className="space-y-1">
                {commonMinutes.map(minute => (
                  <button
                    key={minute}
                    type="button"
                    className={`w-full rounded px-2 py-1 text-center text-sm transition-colors ${
                      selectedMinute === minute
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedMinute(minute)}
                  >
                    {minute.toString().padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>

            {/* AM/PM */}
            <div className="flex-1">
              <div className="space-y-1">
                {periods.map(period => (
                  <button
                    key={period}
                    type="button"
                    className={`w-full rounded px-2 py-1 text-center text-sm transition-colors ${
                      selectedPeriod === period
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedPeriod(period)}
                  >
                    {period}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleNow}
              className="flex-1 rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50"
            >
              {t('common.operation.now')}
            </button>
            <button
              type="button"
              onClick={handleOK}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
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
