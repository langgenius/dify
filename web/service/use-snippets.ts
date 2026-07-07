import type {
  SnippetCanvasData,
  SnippetDetailPayload,
  SnippetDetail as SnippetDetailUIModel,
  SnippetInputField as SnippetInputFieldUIModel,
  SnippetListItem as SnippetListItemUIModel,
} from '@/models/snippet'
import type {
  CreateSnippetPayload,
  IncrementSnippetUseCountResponse,
  Snippet as SnippetContract,
  SnippetDSLImportResponse,
  SnippetImportPayload,
  SnippetListResponse,
  SnippetWorkflow,
  UpdateSnippetPayload,
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
  tag_ids?: string[]
  creator_ids?: string[]
  is_published?: boolean
}

type SnippetSummary = Pick<SnippetContract, 'id' | 'name' | 'description' | 'use_count' | 'tags' | 'updated_at' | 'is_published'>
type SnippetIdInput = {
  params: {
    snippetId: string
  }
}
type CreateSnippetInput = {
  body: CreateSnippetPayload
}
type UpdateSnippetInput = SnippetIdInput & {
  body: UpdateSnippetPayload
}

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

const toSnippetListItem = (snippet: SnippetSummary): SnippetListItemUIModel => {
  return {
    id: snippet.id,
    name: snippet.name,
    description: snippet.description,
    updatedAt: formatTimestamp(snippet.updated_at),
    usage: String(snippet.use_count ?? 0),
    tags: snippet.tags,
    is_published: snippet.is_published,
    status: undefined,
  }
}

const toSnippetDetail = (snippet: SnippetContract): SnippetDetailUIModel => {
  return {
    ...toSnippetListItem(snippet),
  }
}

const toSnippetCanvasData = (workflow?: SnippetWorkflow | null): SnippetCanvasData => {
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

export const buildSnippetDetailPayload = (snippet: SnippetContract, workflow?: SnippetWorkflow | null): SnippetDetailPayload => {
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
    ...(params.tag_ids?.length ? { tag_ids: params.tag_ids } : {}),
    ...(params.creator_ids?.length ? { creator_ids: params.creator_ids } : {}),
    ...(typeof params.is_published === 'boolean' ? { is_published: params.is_published } : {}),
  }
}

const snippetListRootKey = ['snippets', 'list'] as const
const snippetListKey = (params: SnippetListParams) => [...snippetListRootKey, params]
const customizedSnippetsContract = consoleQuery.workspaces.current.customizedSnippets
const customizedSnippetsClient = consoleClient.workspaces.current.customizedSnippets

const invalidateSnippetQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({
    queryKey: customizedSnippetsContract.key(),
  })
  queryClient.invalidateQueries({
    queryKey: consoleQuery.snippets.key(),
  })
  queryClient.invalidateQueries({
    queryKey: snippetListRootKey,
  })
}

const toGeneratedSnippetListQuery = (params: SnippetListParams) => {
  return {
    page: params.page,
    limit: params.limit,
    ...(params.keyword ? { keyword: params.keyword } : {}),
    ...(params.tag_ids?.length ? { tag_ids: params.tag_ids } : {}),
    ...(params.creator_ids?.length ? { creators: params.creator_ids } : {}),
    ...(typeof params.is_published === 'boolean' ? { is_published: params.is_published } : {}),
  }
}

export const useInfiniteSnippetList = (params: SnippetListParams = {}, options?: { enabled?: boolean }) => {
  const normalizedParams = normalizeSnippetListParams(params)

  return useInfiniteQuery<SnippetListResponse>({
    queryKey: snippetListKey(normalizedParams),
    queryFn: ({ pageParam = normalizedParams.page }) => {
      return customizedSnippetsClient.get({
        query: {
          ...toGeneratedSnippetListQuery(normalizedParams),
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
  return useQuery({
    ...customizedSnippetsContract.bySnippetId.get.queryOptions({
      input: {
        params: { snippet_id: snippetId },
      },
    }),
    enabled: !!snippetId,
  })
}

export const useCreateSnippetMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<SnippetContract, Error, CreateSnippetInput>({
    mutationKey: customizedSnippetsContract.post.mutationKey(),
    mutationFn: input => customizedSnippetsClient.post(input),
    onSuccess: () => {
      invalidateSnippetQueries(queryClient)
    },
  })
}

export const useUpdateSnippetMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<SnippetContract, Error, UpdateSnippetInput>({
    mutationKey: customizedSnippetsContract.bySnippetId.patch.mutationKey(),
    mutationFn: ({ params, body }) => customizedSnippetsClient.bySnippetId.patch({
      params: {
        snippet_id: params.snippetId,
      },
      body,
    }),
    onSuccess: () => {
      invalidateSnippetQueries(queryClient)
    },
  })
}

export const useDeleteSnippetMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<unknown, Error, SnippetIdInput>({
    mutationKey: customizedSnippetsContract.bySnippetId.delete.mutationKey(),
    mutationFn: ({ params }) => customizedSnippetsClient.bySnippetId.delete({
      params: {
        snippet_id: params.snippetId,
      },
    }),
    onSuccess: () => {
      invalidateSnippetQueries(queryClient)
    },
  })
}

export const useIncrementSnippetUseCountMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<IncrementSnippetUseCountResponse, Error, SnippetIdInput>({
    mutationKey: customizedSnippetsContract.bySnippetId.useCount.increment.post.mutationKey(),
    mutationFn: ({ params }) => customizedSnippetsClient.bySnippetId.useCount.increment.post({
      params: {
        snippet_id: params.snippetId,
      },
    }),
    onSuccess: () => {
      invalidateSnippetQueries(queryClient)
    },
  })
}

export const useExportSnippetMutation = () => {
  return useMutation<string, Error, { snippetId: string, include?: boolean }>({
    mutationFn: ({ snippetId, include = false }) => {
      return customizedSnippetsClient.bySnippetId.export.get({
        params: { snippet_id: snippetId },
        query: { include_secret: include ? 'true' : 'false' },
      })
    },
  })
}

export const useImportSnippetDSLMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<SnippetDSLImportResponse, Error, { mode: 'yaml-content' | 'yaml-url', yamlContent?: string, yamlUrl?: string }>({
    mutationFn: ({ mode, yamlContent, yamlUrl }) => {
      const body: SnippetImportPayload = {
        mode,
        yaml_content: yamlContent,
        yaml_url: yamlUrl,
      }

      return customizedSnippetsClient.imports.post({
        body,
      })
    },
    onSuccess: () => {
      invalidateSnippetQueries(queryClient)
    },
  })
}

export const useConfirmSnippetImportMutation = () => {
  const queryClient = useQueryClient()

  return useMutation<SnippetDSLImportResponse, Error, { importId: string }>({
    mutationFn: ({ importId }) => {
      return customizedSnippetsClient.imports.byImportId.confirm.post({
        params: {
          import_id: importId,
        },
      })
    },
    onSuccess: () => {
      invalidateSnippetQueries(queryClient)
    },
  })
}
