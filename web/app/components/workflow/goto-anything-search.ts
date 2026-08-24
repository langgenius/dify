import type { SearchResult } from '@/app/components/goto-anything/actions/types'

type SearchWorkflowNodes = (query: string) => SearchResult[]

let searchWorkflowNodes: SearchWorkflowNodes | undefined

export function registerWorkflowNodeSearch(search: SearchWorkflowNodes) {
  searchWorkflowNodes = search

  return () => {
    if (searchWorkflowNodes === search) searchWorkflowNodes = undefined
  }
}

export function findWorkflowNodes(query: string) {
  return searchWorkflowNodes?.(query) ?? []
}
