import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCalendarLine } from '@remixicon/react'
import { getDefaultDateTime } from '../utils/execution-time-calculator'

type DateTimePickerProps = {
  value?: string
  onChange: (datetime: string) => void
}

const DateTimePicker = ({ value, onChange }: DateTimePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [tempValue, setTempValue] = useState('')

  React.useEffect(() => {
    if (isOpen)
      setTempValue('')
  }, [isOpen])

  const getCurrentDateTime = () => {
    if (value) {
      try {
        const date = new Date(value)
        return `${date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })} ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}`
      }
 catch {
        // fallback
      }
    }

    const defaultDate = getDefaultDateTime()

    return `${defaultDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })} ${defaultDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })}`
  }

  const handleDateTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const dateTimeValue = event.target.value
    setTempValue(dateTimeValue)
  }

  const getInputValue = () => {
    if (tempValue)
      return tempValue

    if (value) {
      try {
        const date = new Date(value)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hours = String(date.getHours()).padStart(2, '0')
        const minutes = String(date.getMinutes()).padStart(2, '0')
        return `${year}-${month}-${day}T${hours}:${minutes}`
      }
 catch {
        // fallback
      }
    }

    const defaultDate = getDefaultDateTime()
    const year = defaultDate.getFullYear()
    const month = String(defaultDate.getMonth() + 1).padStart(2, '0')
    const day = String(defaultDate.getDate()).padStart(2, '0')
    const hours = String(defaultDate.getHours()).padStart(2, '0')
    const minutes = String(defaultDate.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 w-full items-center justify-between rounded-lg bg-components-input-bg-normal px-3 py-1.5 text-sm text-text-secondary hover:bg-components-input-bg-hover"
      >
        <span>{getCurrentDateTime()}</span>
        <RiCalendarLine className="h-4 w-4 text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 select-none rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
          <div className="mb-3">
            <h3 className="text-sm font-medium text-gray-900">{t('workflow.nodes.triggerSchedule.selectDateTime')}</h3>
          </div>

          <div className="mb-4 border-b border-gray-100" />

          <div className="mb-4">
            <input
              type="datetime-local"
              value={getInputValue()}
              onChange={handleDateTimeChange}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                onChange(now.toISOString())
                setTempValue('')
                setIsOpen(false)
              }}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('common.operation.now')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (tempValue) {
                  const date = new Date(tempValue)
                  onChange(date.toISOString())
                }
                setTempValue('')
                setIsOpen(false)
              }}
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
          onClick={() => {
            setTempValue('')
            setIsOpen(false)
          }}
        />
      )}
    </div>
  )
}

export default DateTimePicker
