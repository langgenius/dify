import type { Dayjs } from 'dayjs'
import type { Locale } from '@/i18n'
import { localeMap } from '@/i18n/language'
import 'dayjs/locale/ar'
import 'dayjs/locale/az'
import 'dayjs/locale/de'
import 'dayjs/locale/es'
import 'dayjs/locale/fa'
import 'dayjs/locale/fr'
import 'dayjs/locale/hi'
import 'dayjs/locale/id'
import 'dayjs/locale/it'
import 'dayjs/locale/nl'
import 'dayjs/locale/ja'
import 'dayjs/locale/ko'
import 'dayjs/locale/lo'
import 'dayjs/locale/pl'
import 'dayjs/locale/pt-br'
import 'dayjs/locale/ro'
import 'dayjs/locale/ru'
import 'dayjs/locale/sl'
import 'dayjs/locale/th'
import 'dayjs/locale/tr'
import 'dayjs/locale/uk'
import 'dayjs/locale/vi'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

export const formatNumber = (num: number | string) => {
  if (!num) return num
  const n = typeof num === 'string' ? Number(num) : num

  let numStr: string

  if (Math.abs(n) < 0.001 && n !== 0) {
    const str = n.toString()
    const match = /e-(\d+)$/.exec(str)
    let precision: number
    if (match) {
      const exponent = Number.parseInt(match[1]!, 10)
      const mantissa = str.split('e')[0]
      const mantissaDecimalPart = mantissa!.split('.')[1]
      precision = exponent + (mantissaDecimalPart?.length || 0)
    } else {
      const decimalPart = str.split('.')[1]
      precision = decimalPart?.length || 0
    }
    numStr = n.toFixed(precision)
  } else {
    numStr = n.toString()
  }

  const parts = numStr.split('.')
  parts[0] = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

export const formatFileSize = (fileSize: number) => {
  if (!fileSize) return fileSize
  const units = ['', 'K', 'M', 'G', 'T', 'P']
  let index = 0
  while (fileSize >= 1024 && index < units.length - 1) {
    fileSize = fileSize / 1024
    index++
  }
  if (index === 0) return `${fileSize.toFixed(2)} bytes`
  return `${fileSize.toFixed(2)} ${units[index]}B`
}

export const formatTime = (seconds: number) => {
  if (!seconds) return seconds
  const units = ['sec', 'min', 'h']
  let index = 0
  while (seconds >= 60 && index < units.length - 1) {
    seconds = seconds / 60
    index++
  }
  return `${seconds.toFixed(2)} ${units[index]}`
}

export const formatNumberAbbreviated = (num: number) => {
  if (num < 1000) return num.toString()

  const units = [
    { value: 1e9, symbol: 'B' },
    { value: 1e6, symbol: 'M' },
    { value: 1e3, symbol: 'k' },
  ]

  for (let i = 0; i < units.length; i++) {
    if (num >= units[i]!.value) {
      const value = num / units[i]!.value
      let rounded = Math.round(value * 10) / 10
      let unitIndex = i

      if (rounded >= 1000 && i > 0) {
        rounded = rounded / 1000
        unitIndex = i - 1
      }

      const formatted = rounded.toFixed(1)
      return formatted.endsWith('.0')
        ? `${Number.parseInt(formatted)}${units[unitIndex]!.symbol}`
        : `${formatted}${units[unitIndex]!.symbol}`
    }
  }
  return num.toString()
}

export const formatToLocalTime = (time: Dayjs, local: Locale, format: string) => {
  return time.locale(localeMap[local] ?? 'en').format(format)
}

export const getFileExtension = (fileName: string): string => {
  if (!fileName) return ''

  const dotIndex = fileName.indexOf('.', fileName.startsWith('.') ? 1 : 0)
  if (dotIndex === -1 || dotIndex === fileName.length - 1) return ''

  return (
    fileName
      .slice(dotIndex + 1)
      .split('.')
      .pop()
      ?.toLowerCase() ?? ''
  )
}
