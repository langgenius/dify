import Papa from 'papaparse'
import { downloadBlob } from './download'

export function downloadCSV(
  data: Array<Record<string, string> | string []>,
  filename: string,
  options?: {
    bom?: boolean
    delimiter?: string
  },
): void {
  const { bom = true, delimiter } = options || {}

  const csv = Papa.unparse(data, {
    delimiter,
  })

  const blob = new Blob([bom ? '\uFEFF' : '', csv], { type: 'text/csv;charset=utf-8;' })
  downloadBlob({ data: blob, fileName: `${filename}.csv` })
}

export function parseCSV(
  file: File,
  options?: {
    header?: boolean
    skipEmptyLines?: boolean
  },
): Promise<Papa.ParseResult<string[]>> {
  const { header = false, skipEmptyLines = true } = options || {}

  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header,
      skipEmptyLines,
      complete: resolve,
      error: reject,
    })
  })
}
