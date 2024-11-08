import { get } from './base'
import type {
  Tool,
} from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import {
  useQueryClient,
} from '@tanstack/react-query'

import {
  useQuery,
} from '@tanstack/react-query'

const NAME_SPACE = 'tools'

export const useAllBuiltInTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: [NAME_SPACE, 'builtIn'],
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/builtin'),
  })
}

const useAllCustomToolsKey = [NAME_SPACE, 'customTools']
export const useAllCustomTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllCustomToolsKey,
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/api'),
  })
}

export const useInvalidateAllCustomTools = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: useAllCustomToolsKey,
      })
  }
}

export const useAllWorkflowTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: [NAME_SPACE, 'workflowTools'],
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/workflow'),
  })
}

export const useBuiltInTools = (collectionName: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'builtIn', collectionName],
    queryFn: () => get<Tool[]>(`/workspaces/current/tool-provider/builtin/${collectionName}/tools`),
  })
}
