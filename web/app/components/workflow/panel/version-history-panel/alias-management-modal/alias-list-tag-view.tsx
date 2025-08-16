import React from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { workflowAliasTranslation } from '@/i18n/zh-Hans/workflow-alias'
import type { WorkflowAlias } from '@/app/components/workflow/types'

type AliasListTagViewProps = {
  aliases: WorkflowAlias[]
  onDeleteAlias: (alias: WorkflowAlias) => void
}

const AliasListTagView: React.FC<AliasListTagViewProps> = ({
  aliases,
  onDeleteAlias,
}) => {
  const aliasT = workflowAliasTranslation

  const systemAliases = aliases.filter(alias => alias.alias_type === 'system')
  const customAliases = aliases.filter(alias => alias.alias_type === 'custom')

  return (
    <div className="space-y-4">
      {systemAliases.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            {aliasT.systemType} ({systemAliases.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {systemAliases.map(alias => (
              <div
                key={alias.id}
                className="group relative inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 transition-colors hover:bg-blue-100"
              >
                <span className="text-sm font-medium text-blue-700">
                  {alias.alias_name}
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

      {customAliases.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            {aliasT.customType} ({customAliases.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {customAliases.map(alias => (
              <div
                key={alias.id}
                className="group relative inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 transition-colors hover:bg-gray-100"
              >
                <span className="text-sm font-medium text-gray-700">
                  {alias.alias_name}
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
