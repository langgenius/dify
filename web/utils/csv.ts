import Papa from 'papaparse'
import { downloadBlob } from './download'

export function downloadCSV(
  data: Record<string, string>[] | string[][],
  filename: string,
  options?: {
    bom?: boolean
    delimiter?: string
  },
): void {
  const { bom = true, delimiter } = options || {}

  const csv = Papa.unparse(data as unknown[], {
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
    complete?: (results: Papa.ParseResult<string[]>) => void
  },
): void {
  const { header = false, skipEmptyLines = true, complete } = options || {}

  // eslint-disable-next-line ts/no-explicit-any
  Papa.parse(file as any, {
    header,
    skipEmptyLines,
    complete,
  })
}
