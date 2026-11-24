'use client'

import type { z } from 'zod/v4'
import type { TableDefinition } from '../registry/definitions'
import { memo } from 'react'

// OpenUI broadcasts field updates to every registered component. The table only needs its data.
export const GeneratedTable = memo(
  ({ caption, columns, rows }: z.infer<typeof TableDefinition.props>) => {
    return (
      <div className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-start system-sm-regular text-text-secondary">
          <caption className="pb-2 text-start system-sm-medium text-text-primary">
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  // oxlint-disable-next-line react/no-array-index-key -- Table columns have positional identity and contain no stateful controls.
                  key={index}
                  scope="col"
                  className="border-b border-divider-regular px-3 py-2 text-start font-medium"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              // oxlint-disable-next-line react/no-array-index-key -- Table rows have positional identity and contain no stateful controls.
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td
                    // oxlint-disable-next-line react/no-array-index-key -- Table cells have positional identity and contain no stateful controls.
                    key={columnIndex}
                    className="border-b border-divider-subtle px-3 py-2"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },
)
