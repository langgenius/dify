import type { ModelType } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import type {
  CustomConfigurationModelFixedFields,
  DefaultModel,
  ModelProvider,
} from './declarations'
import { ORPCError } from '@orpc/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import {
  useMarketplaceLoadFailure,
  useMarketplacePluginsByCollectionId,
} from '@/app/components/plugins/marketplace/hooks'
import {
  MARKETPLACE_PANEL_CACHE_OPTIONS,
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/query'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { toast } from '@/app/notifications'
import { reportRequestError } from '@/app/query-error-toast'
import { getModelLanguage } from '@/i18n/metadata'
import { consoleQuery } from '@/service/console'
import { useExpandModelProviderList } from './atoms'
import { CustomConfigurationStatusEnum, ModelStatusEnum, ModelTypeEnum } from './declarations'
import { modelProviderDetailsQueryOptions } from './utils'

export const useLanguage = () => {
  const locale = useLocale()
  return getModelLanguage(locale)
}

type ModelQueryOptions = {
  enabled?: boolean
}

export const useDefaultModel = (
  type: ModelTypeEnum,
  { enabled = true }: ModelQueryOptions = {},
) => {
  const query = useQuery(
    consoleQuery.workspaces.current.defaultModel.get.queryOptions({
      input: { query: { model_type: type } },
      enabled,
    }),
  )
  const { data, refetch, isFetching, isPending, isError } = query

  return {
    // An unset default model comes back as null.
    data: data?.data ?? undefined,
    mutate: refetch,
    isLoading: enabled && isPending,
    // A failed first load is unknown, not unset.
    isLoadFailed: isError && data === undefined,
    isFetching,
    /** For a caller that renders a failed load: pass it to `useOwnedQueryError`. */
    query,
  }
}

export const getCurrentProviderAndModel = <
  TProvider extends { models: Array<{ model: string }>; provider: string },
>(
  modelList: TProvider[],
  defaultModel?: DefaultModel,
) => {
  const currentProvider = modelList.find((provider) => provider.provider === defaultModel?.provider)
  const currentModel: TProvider['models'][number] | undefined = currentProvider?.models.find(
    (model) => model.model === defaultModel?.model,
  )

  return {
    currentProvider,
    currentModel,
  }
}

export { getCurrentProviderAndModel as useCurrentProviderAndModel }

export const useTextGenerationCurrentProviderAndModelAndModelList = (
  defaultModel?: DefaultModel,
) => {
  const { data: textGenerationModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )
  const activeTextGenerationModelList = textGenerationModelList.filter(
    (model) => model.status === ModelStatusEnum.active,
  )
  const { currentProvider, currentModel } = getCurrentProviderAndModel(
    textGenerationModelList,
    defaultModel,
  )

  return {
    currentProvider,
    currentModel,
    textGenerationModelList,
    activeTextGenerationModelList,
  }
}

export const useModelListAndDefaultModel = (type: ModelTypeEnum) => {
  const modelListQuery = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: type } },
      select: (response) => response.data,
    }),
  )
  const { data: modelList = [] } = modelListQuery
  const defaultModelQuery = useDefaultModel(type)
  const { data: defaultModel } = defaultModelQuery

  return {
    modelList,
    defaultModel,
    // A failed first load is not an empty list or an unset default. For a caller that renders
    // it: pass these to `useOwnedQueryErrors`.
    loadQueries: [modelListQuery, defaultModelQuery.query] as const,
  }
}

export const useModelListAndDefaultModelAndCurrentProviderAndModel = (type: ModelTypeEnum) => {
  const { modelList, defaultModel, loadQueries } = useModelListAndDefaultModel(type)
  const { currentProvider, currentModel } = getCurrentProviderAndModel(modelList, {
    provider: defaultModel?.provider.provider || '',
    model: defaultModel?.model || '',
  })

  return {
    modelList,
    defaultModel,
    loadQueries,
    currentProvider,
    currentModel,
  }
}

export const useUpdateModelList = () => {
  const queryClient = useQueryClient()

  const updateModelList = useCallback(
    (type: ModelTypeEnum | ModelType) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
          input: {
            params: {
              model_type: type,
            },
          },
        }),
      })
    },
    [queryClient],
  )

  return updateModelList
}

export const useInvalidateDefaultModel = () => {
  const queryClient = useQueryClient()

  return useCallback(
    (type: ModelTypeEnum) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.defaultModel.get.queryKey({
          input: { query: { model_type: type } },
        }),
      })
    },
    [queryClient],
  )
}
export const useUpdateModelProviders = () => {
  const queryClient = useQueryClient()

  const updateModelProviders = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
    })
    queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.modelProviders.get.key(),
    })
  }, [queryClient])

  return updateModelProviders
}

/** Loads the provider's details on demand and reports a failed load once, itself. */
export const useLazyModelProviderDetail = (providerName: string) => {
  const { t } = useTranslation(['common'])
  const [enabled, setEnabled] = useState(false)
  const queryClient = useQueryClient()
  const { data, isFetching } = useQuery({
    ...modelProviderDetailsQueryOptions(),
    enabled,
  })
  const providerDetail = data?.data.find((provider) => provider.provider === providerName)

  const loadProviderDetail = useCallback(async () => {
    setEnabled(true)
    try {
      // The catch reports a failure, so the cache's report stays silent.
      const response = await queryClient.query(modelProviderDetailsQueryOptions())
      const detail = response.data.find((provider) => provider.provider === providerName)
      if (!detail) toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      return detail
    } catch (error) {
      // An HTTP failure carries the server's reason; a request that got no response does not.
      if (error instanceof ORPCError) reportRequestError(error)
      else toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      return undefined
    }
  }, [providerName, queryClient, t])

  return {
    providerDetail,
    loadProviderDetail,
    isProviderDetailEnabled: enabled,
    isLoadingProviderDetail: enabled && isFetching,
  }
}

export const useMarketplaceAllPlugins = (
  searchText: string,
  installedPluginIds: string[],
  enabled = true,
) => {
  const exclude = installedPluginIds
  const collection = useMarketplacePluginsByCollectionId(
    enabled ? '__model-settings-pinned-models' : undefined,
  )
  const { plugins: collectionPlugins = [], isLoading: isCollectionLoading } = collection
  // Typing waits 500 ms before searching; clearing the search lists the whole category at once.
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const marketplaceSearchParams = useMemo<PluginsSearchParams | undefined>(() => {
    if (!enabled) return undefined
    if (searchText && debouncedSearchText) {
      return {
        query: debouncedSearchText,
        category: PluginCategoryEnum.model,
        exclude,
        type: 'plugin',
        sort_by: 'install_count',
        sort_order: 'DESC',
      }
    }
    return {
      query: '',
      category: PluginCategoryEnum.model,
      type: 'plugin',
      page_size: 1000,
      exclude,
      sort_by: 'install_count',
      sort_order: 'DESC',
    }
  }, [debouncedSearchText, enabled, exclude, searchText])
  const pluginsQuery = useMarketplacePlugins(marketplaceSearchParams, {
    keepPreviousResults: false,
    ...MARKETPLACE_PANEL_CACHE_OPTIONS,
  })
  const plugins = useMemo(
    () =>
      pluginsQuery.data?.pages.flatMap((page) => page.plugins) ??
      // A failed search lists nothing beyond the pinned collection.
      (pluginsQuery.isError ? [] : undefined),
    [pluginsQuery.data, pluginsQuery.isError],
  )

  const allPlugins = useMemo(() => {
    if (!enabled) return []

    const allPlugins = collectionPlugins.filter((plugin) => !exclude.includes(plugin.plugin_id))

    if (plugins?.length) {
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]

        if (
          !exclude.includes(plugin!.plugin_id) &&
          plugin!.type !== 'bundle' &&
          !allPlugins.find((p) => p.plugin_id === plugin!.plugin_id)
        )
          allPlugins.push(plugin!)
      }
    }

    return allPlugins
  }, [enabled, plugins, collectionPlugins, exclude])

  return {
    plugins:
      enabled && searchText
        ? plugins?.filter((plugin) => !exclude.includes(plugin.plugin_id))
        : allPlugins,
    isLoading: enabled && (isCollectionLoading || pluginsQuery.isLoading),
    ...useMarketplaceLoadFailure(enabled, collection.query, pluginsQuery),
  }
}

export const useRefreshModel = () => {
  const expandModelProviderList = useExpandModelProviderList()
  const queryClient = useQueryClient()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const handleRefreshModel = useCallback(
    (
      provider: ModelProvider,
      CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
      refreshModelList?: boolean,
    ) => {
      const modelProviderModelListQueryKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: {
            params: {
              provider: provider.provider,
            },
          },
        })
      queryClient.invalidateQueries({
        queryKey: modelProviderModelListQueryKey,
        exact: true,
        refetchType: 'none',
      })

      updateModelProviders()

      provider.supported_model_types.forEach((type) => {
        updateModelList(type)
      })

      if (
        refreshModelList &&
        provider.custom_configuration.status === CustomConfigurationStatusEnum.active
      ) {
        expandModelProviderList(provider.provider)
        queryClient.invalidateQueries({
          queryKey: modelProviderModelListQueryKey,
          exact: true,
          refetchType: 'active',
        })

        if (CustomConfigurationModelFixedFields?.__model_type)
          updateModelList(CustomConfigurationModelFixedFields.__model_type)
      }
    },
    [expandModelProviderList, queryClient, updateModelList, updateModelProviders],
  )

  return {
    handleRefreshModel,
  }
}
