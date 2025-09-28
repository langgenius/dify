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
      const formatted = (num / units[i].value).toFixed(1)
      return formatted.endsWith('.0')
        ? `${Number.parseInt(formatted)}${units[i].symbol}`
        : `${formatted}${units[i].symbol}`
    }
  }
}
