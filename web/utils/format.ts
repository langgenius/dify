import type { Locale } from '@/i18n-config'
import type { Dayjs } from 'dayjs'
import 'dayjs/locale/de'
import 'dayjs/locale/es'
import 'dayjs/locale/fa'
import 'dayjs/locale/fr'
import 'dayjs/locale/hi'
import 'dayjs/locale/id'
import 'dayjs/locale/it'
import 'dayjs/locale/ja'
import 'dayjs/locale/ko'
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

const localeMap: Record<Locale, string> = {
  'en-US': 'en',
  'zh-Hans': 'zh-cn',
  'zh-Hant': 'zh-tw',
  'pt-BR': 'pt-br',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'ru-RU': 'ru',
  'it-IT': 'it',
  'th-TH': 'th',
  'id-ID': 'id',
  'uk-UA': 'uk',
  'vi-VN': 'vi',
  'ro-RO': 'ro',
  'pl-PL': 'pl',
  'hi-IN': 'hi',
  'tr-TR': 'tr',
  'fa-IR': 'fa',
  'sl-SI': 'sl',
}

/**
 * Formats a number with comma separators.
 * @example formatNumber(1234567) will return '1,234,567'
 * @example formatNumber(1234567.89) will return '1,234,567.89'
 */
export const formatNumber = (num: number | string) => {
  if (!num)
    return num
  const parts = num.toString().split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

/**
 * Format file size into standard string format.
 * @param fileSize file size (Byte)
 * @example formatFileSize(1024) will return '1.00 KB'
 * @example formatFileSize(1024 * 1024) will return '1.00 MB'
 */
export const formatFileSize = (fileSize: number) => {
  if (!fileSize)
    return fileSize
  const units = ['', 'K', 'M', 'G', 'T', 'P']
  let index = 0
  while (fileSize >= 1024 && index < units.length) {
    fileSize = fileSize / 1024
    index++
  }
  if (index === 0)
    return `${fileSize.toFixed(2)} bytes`
  return `${fileSize.toFixed(2)} ${units[index]}B`
}

/**
 * Format time into standard string format.
 * @example formatTime(60) will return '1.00 min'
 * @example formatTime(60 * 60) will return '1.00 h'
 */
export const formatTime = (seconds: number) => {
  if (!seconds)
    return seconds
  const units = ['sec', 'min', 'h']
  let index = 0
  while (seconds >= 60 && index < units.length) {
    seconds = seconds / 60
    index++
  }
  return `${seconds.toFixed(2)} ${units[index]}`
}

export const downloadFile = ({ data, fileName }: { data: Blob; fileName: string }) => {
  const url = window.URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

/**
 * Formats a number into a readable string using "k", "M", or "B" suffix.
 * @example
 * 950     => "950"
 * 1200    => "1.2k"
 * 1500000 => "1.5M"
 * 2000000000 => "2B"
 *
 * @param {number} num - The number to format
 * @returns {string} - The formatted number string
 */
export const formatNumberAbbreviated = (num: number) => {
  // If less than 1000, return as-is
  if (num < 1000) return num.toString()

  // Define thresholds and suffixes
  const units = [
    { value: 1e9, symbol: 'B' },
    { value: 1e6, symbol: 'M' },
    { value: 1e3, symbol: 'k' },
  ]

  for (let i = 0; i < units.length; i++) {
    if (num >= units[i].value) {
      const value = num / units[i].value
      let rounded = Math.round(value * 10) / 10
      let unitIndex = i

      // If rounded value >= 1000, promote to next unit
      if (rounded >= 1000 && i > 0) {
        rounded = rounded / 1000
        unitIndex = i - 1
      }

      const formatted = rounded.toFixed(1)
      return formatted.endsWith('.0')
        ? `${Number.parseInt(formatted)}${units[unitIndex].symbol}`
        : `${formatted}${units[unitIndex].symbol}`
    }
  }
}

export const formatToLocalTime = (time: Dayjs, local: string, format: string) => {
  return time.locale(localeMap[local] ?? 'en').format(format)
}
