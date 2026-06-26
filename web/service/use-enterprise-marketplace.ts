import type {
  EnterpriseMarketplaceAsset,
  EnterpriseMarketplaceAssetListResponse,
  EnterpriseMarketplaceAssetStatus,
  EnterpriseMarketplaceSubmissionListResponse,
  EnterpriseMarketplaceUseResponse,
} from '@/models/enterprise-marketplace'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from './base'

const enterpriseMarketplaceListStaleTime = 30 * 1000

type PublicAssetListParams = {
  keyword?: string
  category?: string
  page?: number
  limit?: number
}

type AdminAssetListParams = {
  keyword?: string
  status?: EnterpriseMarketplaceAssetStatus
  page?: number
  limit?: number
}

const fetchEnterpriseMarketplaceAssets = ({ url, params }: { url: string, params?: Record<string, unknown> }) => {
  return get<EnterpriseMarketplaceAssetListResponse>(url, { params })
}

const fetchEnterpriseMarketplaceSubmissions = ({ url }: { url: string }) => {
  return get<EnterpriseMarketplaceSubmissionListResponse>(url)
}

const submitEnterpriseMarketplaceAsset = ({ url, body }: { url: string, body: Record<string, unknown> }) => {
  return post<EnterpriseMarketplaceAssetListResponse>(url, { body })
}

const reviewEnterpriseMarketplaceAsset = ({ url, body }: { url: string, body: Record<string, unknown> }) => {
  return post<EnterpriseMarketplaceAssetListResponse>(url, { body })
}

const unlistEnterpriseMarketplaceAsset = ({ url }: { url: string }) => {
  return post<EnterpriseMarketplaceAssetListResponse>(url)
}

const requestEnterpriseMarketplaceAssetUse = ({ url }: { url: string }) => {
  return post<EnterpriseMarketplaceUseResponse>(url)
}

export const enterpriseMarketplaceKeys = {
  all: ['enterprise-marketplace'] as const,
  publicLists: () => [...enterpriseMarketplaceKeys.all, 'public-list'] as const,
  publicList: (params: PublicAssetListParams) => [...enterpriseMarketplaceKeys.all, 'public-list', params] as const,
  mySubmissions: () => [...enterpriseMarketplaceKeys.all, 'my-submissions'] as const,
  adminLists: () => [...enterpriseMarketplaceKeys.all, 'admin-list'] as const,
  adminList: (params: AdminAssetListParams) => [...enterpriseMarketplaceKeys.all, 'admin-list', params] as const,
}

const invalidateEnterpriseMarketplacePublicLists = (queryClient: ReturnType<typeof useQueryClient>) => {
  return queryClient.invalidateQueries({
    queryKey: enterpriseMarketplaceKeys.publicLists(),
  })
}

const invalidateEnterpriseMarketplaceAdminLists = (queryClient: ReturnType<typeof useQueryClient>) => {
  return queryClient.invalidateQueries({
    queryKey: enterpriseMarketplaceKeys.adminLists(),
  })
}

const invalidateEnterpriseMarketplaceSubmissions = (queryClient: ReturnType<typeof useQueryClient>) => {
  return queryClient.invalidateQueries({
    queryKey: enterpriseMarketplaceKeys.mySubmissions(),
    exact: true,
  })
}

export const useEnterpriseMarketplacePublicAssets = (params: PublicAssetListParams) => {
  return useQuery<EnterpriseMarketplaceAssetListResponse>({
    queryKey: enterpriseMarketplaceKeys.publicList(params),
    queryFn: () => fetchEnterpriseMarketplaceAssets({
      url: '/enterprise-marketplace/assets',
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 24,
        keyword: params.keyword,
        category: params.category,
      },
    }),
    placeholderData: keepPreviousData,
    staleTime: enterpriseMarketplaceListStaleTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useEnterpriseMarketplaceMySubmissions = () => {
  return useQuery<EnterpriseMarketplaceSubmissionListResponse>({
    queryKey: enterpriseMarketplaceKeys.mySubmissions(),
    queryFn: () => fetchEnterpriseMarketplaceSubmissions({
      url: '/enterprise-marketplace/submissions',
    }),
    staleTime: enterpriseMarketplaceListStaleTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useSubmitEnterpriseMarketplaceAsset = (appId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      title: string
      description: string
      category: string
      tags: string[]
      scenario: string
      allow_show_workspace_name: boolean
    }) => submitEnterpriseMarketplaceAsset({
      url: `/apps/${appId}/enterprise-marketplace/submissions`,
      body,
    }),
    onSuccess: async () => {
      await Promise.all([
        invalidateEnterpriseMarketplaceSubmissions(queryClient),
        invalidateEnterpriseMarketplaceAdminLists(queryClient),
      ])
    },
  })
}

export const useAdminEnterpriseMarketplaceAssets = (params: AdminAssetListParams) => {
  return useQuery<EnterpriseMarketplaceAssetListResponse>({
    queryKey: enterpriseMarketplaceKeys.adminList(params),
    queryFn: () => fetchEnterpriseMarketplaceAssets({
      url: '/platform-admin/enterprise-marketplace/assets',
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 50,
        keyword: params.keyword,
        status: params.status,
      },
    }),
    placeholderData: keepPreviousData,
    staleTime: enterpriseMarketplaceListStaleTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useReviewEnterpriseMarketplaceAsset = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ assetId, status, review_note }: { assetId: string, status: 'approved' | 'rejected', review_note?: string }) => {
      return reviewEnterpriseMarketplaceAsset({
        url: `/platform-admin/enterprise-marketplace/assets/${assetId}/review`,
        body: { status, review_note },
      })
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateEnterpriseMarketplaceAdminLists(queryClient),
        invalidateEnterpriseMarketplacePublicLists(queryClient),
        invalidateEnterpriseMarketplaceSubmissions(queryClient),
      ])
    },
  })
}

export const useUnlistEnterpriseMarketplaceAsset = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) => unlistEnterpriseMarketplaceAsset({
      url: `/platform-admin/enterprise-marketplace/assets/${assetId}/unlist`,
    }),
    onSuccess: async () => {
      await Promise.all([
        invalidateEnterpriseMarketplaceAdminLists(queryClient),
        invalidateEnterpriseMarketplacePublicLists(queryClient),
        invalidateEnterpriseMarketplaceSubmissions(queryClient),
      ])
    },
  })
}

export const useUseEnterpriseMarketplaceAsset = () => {
  return useMutation<EnterpriseMarketplaceUseResponse, Error, string>({
    mutationFn: assetId => requestEnterpriseMarketplaceAssetUse({
      url: `/enterprise-marketplace/assets/${assetId}/use`,
    }),
  })
}

export const getMarketplaceAssetCategories = (items: EnterpriseMarketplaceAsset[]) => {
  return Array.from(new Set(items.map(item => item.category).filter(Boolean)))
}
