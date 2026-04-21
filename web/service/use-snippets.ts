import type {
  SnippetCanvasData,
  SnippetDetailPayload,
  SnippetDetail as SnippetDetailUIModel,
  SnippetInputField as SnippetInputFieldUIModel,
  SnippetListItem as SnippetListItemUIModel,
} from '@/models/snippet'
import type {
  Snippet as SnippetContract,
  SnippetDSLImportResponse,
  SnippetListResponse,
  SnippetWorkflow,
} from '@/types/snippet'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import dayjs from 'dayjs'
import { consoleClient, consoleQuery } from '@/service/client'

type SnippetListParams = {
  page?: number
  limit?: number
  keyword?: string
  creator_id?: string
  is_published?: boolean
}

type SnippetSummary = Pick<SnippetContract, 'id' | 'name' | 'description' | 'use_count' | 'icon_info' | 'updated_at' | 'is_published'>

const DEFAULT_SNIPPET_LIST_PARAMS = {
  page: 1,
  limit: 30,
} satisfies Required<Pick<SnippetListParams, 'page' | 'limit'>>

const DEFAULT_GRAPH: SnippetCanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

const toMilliseconds = (timestamp?: number) => {
  if (!timestamp)
    return undefined

  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
}

const formatTimestamp = (timestamp?: number) => {
  const milliseconds = toMilliseconds(timestamp)
  if (!milliseconds)
    return ''

  return dayjs(milliseconds).format('YYYY-MM-DD HH:mm')
}

const getSnippetIcon = (iconInfo: SnippetContract['icon_info']) => {
  return typeof iconInfo?.icon === 'string' ? iconInfo.icon : ''
}

const getSnippetIconBackground = (iconInfo: SnippetContract['icon_info']) => {
  return typeof iconInfo?.icon_background === 'string' ? iconInfo.icon_background : ''
}

const toSnippetListItem = (snippet: SnippetSummary): SnippetListItemUIModel => {
  return {
    id: snippet.id,
    name: snippet.name,
    description: snippet.description,
    author: '',
    updatedAt: formatTimestamp(snippet.updated_at),
    usage: String(snippet.use_count ?? 0),
    icon: getSnippetIcon(snippet.icon_info),
    iconBackground: getSnippetIconBackground(snippet.icon_info),
    is_published: snippet.is_published,
    status: undefined,
  }
}

const toSnippetDetail = (snippet: SnippetContract): SnippetDetailUIModel => {
  return {
    ...toSnippetListItem(snippet),
  }
}

const toSnippetCanvasData = (workflow?: SnippetWorkflow): SnippetCanvasData => {
  const graph = workflow?.graph

  if (!graph || typeof graph !== 'object')
    return DEFAULT_GRAPH

  const graphRecord = graph as Record<string, unknown>

  return {
    nodes: Array.isArray(graphRecord.nodes) ? graphRecord.nodes as SnippetCanvasData['nodes'] : DEFAULT_GRAPH.nodes,
    edges: Array.isArray(graphRecord.edges) ? graphRecord.edges as SnippetCanvasData['edges'] : DEFAULT_GRAPH.edges,
    viewport: graphRecord.viewport && typeof graphRecord.viewport === 'object'
      ? graphRecord.viewport as SnippetCanvasData['viewport']
      : DEFAULT_GRAPH.viewport,
  }
}

export const buildSnippetDetailPayload = (snippet: SnippetContract, workflow?: SnippetWorkflow): SnippetDetailPayload => {
  const inputFields = Array.isArray(workflow?.input_fields)
    ? workflow.input_fields as SnippetInputFieldUIModel[]
    : []

  return {
    snippet: toSnippetDetail(snippet),
    graph: toSnippetCanvasData(workflow),
    inputFields,
    uiMeta: {
      inputFieldCount: inputFields.length,
      checklistCount: 0,
      autoSavedAt: formatTimestamp(workflow?.updated_at ?? snippet.updated_at),
    },
  }
}

const normalizeSnippetListParams = (params: SnippetListParams) => {
  return {
    page: params.page ?? DEFAULT_SNIPPET_LIST_PARAMS.page,
    limit: params.limit ?? DEFAULT_SNIPPET_LIST_PARAMS.limit,
    ...(params.keyword ? { keyword: params.keyword } : {}),
    ...(params.creator_id ? { creator_id: params.creator_id } : {}),
    ...(typeof params.is_published === 'boolean' ? { is_published: params.is_published } : {}),
  }
}

const snippetListKey = (params: SnippetListParams) => ['snippets', 'list', params]

export const useInfiniteSnippetList = (params: SnippetListParams = {}, options?: { enabled?: boolean }) => {
  const normalizedParams = normalizeSnippetListParams(params)

  return useInfiniteQuery<SnippetListResponse>({
    queryKey: snippetListKey(normalizedParams),
    queryFn: ({ pageParam = normalizedParams.page }) => {
      return consoleClient.snippets.list({
        query: {
          ...normalizedParams,
          page: pageParam as number,
        },
      })
    },
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: normalizedParams.page,
    placeholderData: keepPreviousData,
    ...options,
  })
}

export const useSnippetApiDetail = (snippetId: string) => {
  return useQuery(consoleQuery.snippets.detail.queryOptions({
    input: {
      params: { snippetId },
    },
    enabled: !!snippetId,
  }))
}

export const useCreateSnippetMutation = () => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.snippets.create.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.snippets.key(),
      })
    },
  }))
}

export const useUpdateSnippetMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.snippets.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.snippets.key(),
        })
      },
    }),
  })
}

export const useDeleteSnippetMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.snippets.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.snippets.key(),
        })
      },
    }),
  })
}

export const useExportSnippetMutation = () => {
  return useMutation<string, Error, { snippetId: string, include?: boolean }>({
    mutationFn: ({ snippetId, include = false }) => {
      return consoleClient.snippets.export({
        params: { snippetId },
        query: { include_secret: include ? 'true' : 'false' },
      })
    },
  })
}

export const useImportSnippetDSLMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<SnippetDSLImportResponse, Error, { mode: 'yaml-content' | 'yaml-url', yamlContent?: string, yamlUrl?: string }>({
    mutationFn: ({ mode, yamlContent, yamlUrl }) => {
      return consoleClient.snippets.import({
        body: {
          mode,
          yaml_content: yamlContent,
          yaml_url: yamlUrl,
        },
      }) as Promise<SnippetDSLImportResponse>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.snippets.key(),
      })
    },
  })
}

export const useConfirmSnippetImportMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<SnippetDSLImportResponse, Error, { importId: string }>({
    mutationFn: ({ importId }) => {
      return consoleClient.snippets.confirmImport({
        params: {
          importId,
        },
      }) as Promise<SnippetDSLImportResponse>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.snippets.key(),
      })
    },
  })
}
