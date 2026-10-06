import type { ToolCategory } from '@/app/components/integrations/routes'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { TOOL_CATEGORY_VALUES } from '@/app/components/integrations/routes'

const toolProviderCategorySet = new Set<string>(TOOL_CATEGORY_VALUES)

const isToolProviderCategory = (value: string): value is ToolCategory => {
  return toolProviderCategorySet.has(value)
}

const parseAsToolProviderCategory =
  parseAsStringLiteral(TOOL_CATEGORY_VALUES).withDefault('builtin')

export function useToolProviderCategory(category?: ToolCategory) {
  const [categoryParam, setCategoryParam] = useQueryState('category', parseAsToolProviderCategory)
  const activeTab = category ?? categoryParam
  const isRouteCategory = !!category

  const handleCategoryChange = (state: string, onCategoryChanged?: () => void) => {
    if (!isToolProviderCategory(state)) return

    setCategoryParam(state)

    if (state !== activeTab) onCategoryChanged?.()
  }

  return {
    activeTab,
    handleCategoryChange,
    isRouteCategory,
  }
}
