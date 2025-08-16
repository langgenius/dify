'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { fetchWorkspaceApiKeyScopes } from '@/service/workspace-api-key'
import type { ScopeCategory, WorkspaceApiKeyScopesResponse } from '@/service/workspace-api-key'

export type ScopeSelectorProps = {
  selectedScopes: string[]
  onScopesChange: (scopes: string[]) => void
}

const ScopeSelector: FC<ScopeSelectorProps> = ({
  selectedScopes,
  onScopesChange,
}) => {
  const { t } = useTranslation()
  const { data: scopeData } = useSWR<WorkspaceApiKeyScopesResponse>(
    { url: '/workspaces/current/api-keys/scopes' },
    fetchWorkspaceApiKeyScopes,
  )

  const handleScopeToggle = (scope: string) => {
    const newScopes = selectedScopes.includes(scope)
      ? selectedScopes.filter(s => s !== scope)
      : [...selectedScopes, scope]
    onScopesChange(newScopes)
  }

  const handleCategoryToggle = (category: ScopeCategory) => {
    const categoryScopes = category.scopes
    const allSelected = categoryScopes.every(scope => selectedScopes.includes(scope))

    if (allSelected) {
      // Unselect all scopes in this category
      onScopesChange(selectedScopes.filter(scope => !categoryScopes.includes(scope)))
    }
 else {
      // Select all scopes in this category
      const newScopes = [...new Set([...selectedScopes, ...categoryScopes])]
      onScopesChange(newScopes)
    }
  }

  if (!scopeData) {
    return (
      <div className="py-4">
        <div className="animate-pulse">
          <div className="mb-2 h-4 w-1/4 rounded bg-gray-200"></div>
          <div className="mb-2 h-8 rounded bg-gray-200"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="mb-3 text-sm font-medium leading-9 text-text-primary">
        {t('common.workspaceApiKey.modal.scopesLabel')}
      </div>
      <div className="max-h-64 space-y-4 overflow-y-auto rounded-lg border border-divider-regular p-4">
        {Object.entries(scopeData.categories).map(([categoryKey, category]) => {
          const categoryScopes = category.scopes
          const selectedCount = categoryScopes.filter(scope => selectedScopes.includes(scope)).length
          const isPartiallySelected = selectedCount > 0 && selectedCount < categoryScopes.length
          const isAllSelected = selectedCount === categoryScopes.length

          return (
            <div key={categoryKey} className="space-y-2">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id={`category-${categoryKey}`}
                  checked={isAllSelected}
                  ref={(input) => {
                    if (input)
                      input.indeterminate = isPartiallySelected
                  }}
                  onChange={() => handleCategoryToggle(category)}
                  className="border-components-input-border-idle mr-2 h-4 w-4 rounded text-components-button-primary-bg focus:ring-2 focus:ring-components-button-primary-bg"
                />
                <label
                  htmlFor={`category-${categoryKey}`}
                  className="cursor-pointer text-sm font-medium text-text-primary"
                >
                  {category.name}
                </label>
                <span className="ml-2 text-xs text-text-tertiary">
                  ({selectedCount}/{categoryScopes.length})
                </span>
              </div>
              <div className="ml-6 space-y-1">
                {categoryScopes.map((scope) => {
                  const description = scopeData.scopes[scope] || scope
                  return (
                    <div key={scope} className="flex items-start">
                      <input
                        type="checkbox"
                        id={scope}
                        checked={selectedScopes.includes(scope)}
                        onChange={() => handleScopeToggle(scope)}
                        className="border-components-input-border-idle mr-2 mt-0.5 h-4 w-4 rounded text-components-button-primary-bg focus:ring-2 focus:ring-components-button-primary-bg"
                      />
                      <div className="flex-1">
                        <label
                          htmlFor={scope}
                          className="block cursor-pointer text-sm text-text-primary"
                        >
                          <span className="font-mono text-xs">{scope}</span>
                        </label>
                        <p className="mt-0.5 text-xs text-text-tertiary">
                          {description}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {selectedScopes.length === 0 && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t('common.workspaceApiKey.modal.scopeRequired')}
        </div>
      )}
    </div>
  )
}

export default ScopeSelector
