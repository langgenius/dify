import React from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import Button from '@/app/components/base/button'

import type { WorkflowAlias } from '@/app/components/workflow/types'

type AliasListTagViewProps = {
  aliases: WorkflowAlias[]
  onDeleteAlias: (alias: WorkflowAlias) => void
}

const AliasListTagView: React.FC<AliasListTagViewProps> = ({
  aliases,
  onDeleteAlias,
}) => {
  return (
    <div className="space-y-4">
      {aliases.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            Aliases ({aliases.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {aliases.map(alias => (
              <div
                key={alias.id}
                className="group relative inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 transition-colors hover:bg-gray-100"
              >
                <div className="mr-2 h-2 w-2 rounded-full bg-green-500"></div>
                <span className="text-sm font-medium text-gray-700">
                  {alias.name}
                </span>
                <Button
                  type="button"
                  size="small"
                  onClick={() => onDeleteAlias(alias)}
                  className="ml-2 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <RiDeleteBinLine className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default AliasListTagView
