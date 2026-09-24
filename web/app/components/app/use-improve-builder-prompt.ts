import type { WorkflowInstructionImprovePayload } from '@dify/contracts/api/console/workflow-generate/types.gen'
import type { Dispatch, SetStateAction } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

export const useImproveBuilderPrompt = (
  mode: WorkflowInstructionImprovePayload['mode'],
  onPromptChange: Dispatch<SetStateAction<string>>,
) => {
  const { t, i18n } = useTranslation(['app'])
  const defaultModelQuery = useQuery(
    consoleQuery.workspaces.current.defaultModel.get.queryOptions({
      input: { query: { model_type: 'llm' } },
      context: { silent: true },
      select: (response) => response.data,
      retry: false,
    }),
  )
  const modelsQuery = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: 'llm' } },
      context: { silent: true },
      select: (response) => response.data,
      retry: false,
    }),
  )
  const defaultModel = defaultModelQuery.data
  // Saved defaults can outlive their provider credentials or model availability.
  const provider = modelsQuery.data?.find(
    (item) => item.provider === defaultModel?.provider.provider && item.status === 'active',
  )
  const modelStatus: 'loading' | 'error' | 'ready' | 'unavailable' =
    defaultModelQuery.isPending || (defaultModel && modelsQuery.isPending)
      ? 'loading'
      : defaultModelQuery.isError || (defaultModel && modelsQuery.isError)
        ? 'error'
        : defaultModel &&
            provider?.models.some(
              (model) => model.model === defaultModel.model && model.status === 'active',
            )
          ? 'ready'
          : 'unavailable'
  const mutation = useMutation(
    consoleQuery.workflowGenerate.improve.post.mutationOptions({
      context: { silent: true },
    }),
  )

  return {
    isPending: mutation.isPending,
    modelStatus,
    isCheckingModel: defaultModelQuery.isFetching || modelsQuery.isFetching,
    retryModelCheck: () => {
      void defaultModelQuery.refetch()
      void modelsQuery.refetch()
    },
    improve: (prompt: string) => {
      if (modelStatus !== 'ready') return
      mutation.mutate(
        {
          body: {
            instruction: prompt,
            mode,
            language: i18n.resolvedLanguage ?? i18n.language,
          },
        },
        {
          onSuccess: (result, { body }) => {
            if (result.changed) {
              onPromptChange((current) =>
                current === body.instruction ? result.instruction : current,
              )
            } else {
              toast.info(t(($) => $['newApp.optimizeNoChange'], { ns: 'app' }))
            }
          },
          onError: () => toast.error(t(($) => $['newApp.optimizeFailed'], { ns: 'app' })),
        },
      )
    },
  }
}
