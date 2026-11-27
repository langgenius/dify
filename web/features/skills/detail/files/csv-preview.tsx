'use client'

export function SkillCsvPreview({ rows }: { rows: string[][] }) {
  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0)

  if (rows.length === 0 || columnCount === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background-default">
        <span className="system-sm-regular text-text-tertiary">-</span>
      </div>
    )
  }

  const [headerRow, ...bodyRows] = rows
  const headers = Array.from({ length: columnCount }, (_, index) => headerRow?.[index] ?? '')
  const columnKeys = Array.from({ length: columnCount }, (_, index) => `column-${index + 1}`)

  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden bg-background-default p-1">
      <div className="flex h-6 shrink-0 items-center">
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded-md px-1.5 system-xs-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-table-line size-3.5" />
          workspace
          <span aria-hidden className="i-ri-arrow-down-s-line size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 border-s border-t border-divider-subtle text-start">
          <thead className="sticky top-0 z-10 bg-background-section">
            <tr>
              {headers.map((header, index) => (
                <th
                  key={columnKeys[index]}
                  scope="col"
                  className="h-7 max-w-72 min-w-32 border-e border-b border-divider-subtle px-2 py-1 text-start system-xs-medium text-text-secondary"
                >
                  <span className="block truncate" title={header || undefined}>
                    {header || `#${index + 1}`}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row) => (
              <tr key={row.join('\u0000')} className="hover:bg-state-base-hover">
                {columnKeys.map((columnKey, columnIndex) => {
                  const value = row[columnIndex] ?? ''

                  return (
                    <td
                      key={columnKey}
                      className="h-7 max-w-72 min-w-32 border-e border-b border-divider-subtle px-2 py-1 align-top system-xs-regular text-text-secondary"
                    >
                      <span
                        className="block wrap-break-word whitespace-pre-wrap"
                        title={value || undefined}
                      >
                        {value || '-'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
