import { createLocalStorageState } from 'foxact/create-local-storage-state'

const [useFeaturedToolsCollapsed, _useFeaturedToolsCollapsedValue, _useSetFeaturedToolsCollapsed] =
  createLocalStorageState<boolean>('workflow_tools_featured_collapsed', false)

const [
  useFeaturedTriggersCollapsed,
  _useFeaturedTriggersCollapsedValue,
  _useSetFeaturedTriggersCollapsed,
] = createLocalStorageState<boolean>('workflow_triggers_featured_collapsed', false)

const [
  useRAGRecommendationsCollapsed,
  _useRAGRecommendationsCollapsedValue,
  _useSetRAGRecommendationsCollapsed,
] = createLocalStorageState<boolean>('workflow_rag_recommendations_collapsed', false)

export { useFeaturedToolsCollapsed, useFeaturedTriggersCollapsed, useRAGRecommendationsCollapsed }
