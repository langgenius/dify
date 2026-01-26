import Papa from 'papaparse'

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
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
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

  Papa.parse(file as unknown as string, {
    header,
    skipEmptyLines,
    complete,
  })
}
