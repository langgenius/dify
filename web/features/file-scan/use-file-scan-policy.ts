import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { useFileScanEnabled } from './provider-types'

export type FileScanProduct = 'dataset' | 'knowledge-fs'
export type FallbackAction = 'allow' | 'block'
type FileScanPolicy = {
  enabled: boolean
  on_unavailable: FallbackAction
  on_unscannable: FallbackAction
  provider_id: string | null
}

type FileScanPolicyControllerOptions = {
  /** False while the host page has no resource to show, or shows one that stores no files. */
  active?: boolean
  /** Which knowledge base product `resourceId` belongs to. */
  product: FileScanProduct
  readonly: boolean
  /** The dataset id, or the control space id of an Agent Knowledge Base. */
  resourceId: string
}

/**
 * - `unchanged`: there was nothing to save.
 * - `invalid`: the draft cannot be saved as it is; the section shows what is missing.
 * - `failed`: the request failed; the section shows the reason, and `errorMessage` describes the
 *   failure.
 */
export type FileScanPolicySaveResult =
  | { status: 'failed'; errorMessage: string | undefined }
  | { status: 'invalid' | 'saved' | 'unchanged' }

export type FileScanPolicyController = ReturnType<typeof useFileScanPolicyController>

const DEFAULT_POLICY: FileScanPolicy = {
  enabled: false,
  on_unavailable: 'block',
  on_unscannable: 'block',
  provider_id: null,
}

const fallbackAction = (value: string | undefined): FallbackAction =>
  value === 'allow' ? 'allow' : 'block'

function useFileScanPolicy(product: FileScanProduct, resourceId: string, active: boolean) {
  const datasetPolicy = consoleQuery.datasets.byDatasetId.fileScanPolicy
  const spacePolicy = consoleQuery.knowledgeFs.spaces.byControlSpaceId.fileScanPolicy
  const datasetQuery = useQuery(
    datasetPolicy.get.queryOptions({
      input: { params: { dataset_id: resourceId } },
      enabled: active && product === 'dataset',
    }),
  )
  const spaceQuery = useQuery(
    spacePolicy.get.queryOptions({
      input: { params: { control_space_id: resourceId } },
      enabled: active && product === 'knowledge-fs',
    }),
  )
  const datasetMutation = useMutation(
    datasetPolicy.put.mutationOptions({ meta: { errorToast: false } }),
  )
  const spaceMutation = useMutation(
    spacePolicy.put.mutationOptions({ meta: { errorToast: false } }),
  )
  const query = product === 'dataset' ? datasetQuery : spaceQuery
  const mutation = product === 'dataset' ? datasetMutation : spaceMutation

  return {
    isError: query.isError,
    isPending: query.isPending,
    isSaving: mutation.isPending,
    policy: query.data
      ? {
          enabled: query.data.enabled,
          on_unavailable: fallbackAction(query.data.on_unavailable),
          on_unscannable: fallbackAction(query.data.on_unscannable),
          provider_id: query.data.provider_id ?? null,
        }
      : undefined,
    refetch: () => void query.refetch(),
    resetSaveError: () => mutation.reset(),
    save: async (body: FileScanPolicy) => {
      if (product === 'dataset')
        await datasetMutation.mutateAsync({ body, params: { dataset_id: resourceId } })
      else await spaceMutation.mutateAsync({ body, params: { control_space_id: resourceId } })
    },
    saveError: mutation.error,
  }
}

/**
 * Holds the malware-scan policy draft of one knowledge base.
 *
 * The settings page that hosts the section owns the Save button: it calls `save()` from its own
 * submit and `reset()` from its own cancel, so the policy is saved together with the other settings.
 */
export function useFileScanPolicyController({
  active: requested = true,
  product,
  readonly,
  resourceId,
}: FileScanPolicyControllerOptions) {
  const { t } = useTranslation(['fileScan'])
  const describeRequestError = useRequestErrorDescriber()
  const featureEnabled = useFileScanEnabled()
  const active = featureEnabled && requested
  const { isError, isPending, isSaving, policy, refetch, resetSaveError, save, saveError } =
    useFileScanPolicy(product, resourceId, active)
  const [draft, setDraft] = useState<FileScanPolicy>()
  const [scannerMissing, setScannerMissing] = useState(false)
  const saved = policy ?? DEFAULT_POLICY
  const current = draft ?? saved
  const dirty =
    active &&
    !readonly &&
    (current.enabled !== saved.enabled ||
      current.provider_id !== saved.provider_id ||
      current.on_unavailable !== saved.on_unavailable ||
      current.on_unscannable !== saved.on_unscannable)

  return {
    active,
    current,
    dirty,
    disabled: readonly || isPending || isError || isSaving,
    isError,
    isSaving,
    product,
    refetch,
    reset: () => {
      setDraft(undefined)
      setScannerMissing(false)
      resetSaveError()
    },
    save: async (): Promise<FileScanPolicySaveResult> => {
      if (!dirty) return { status: 'unchanged' }
      if (current.enabled && !current.provider_id) {
        setScannerMissing(true)
        return { status: 'invalid' }
      }
      try {
        await save(current)
      } catch (error) {
        return {
          status: 'failed',
          errorMessage: describeRequestError(
            error,
            t(($) => $['policy.saveFailed']),
          ),
        }
      }
      setDraft(undefined)
      return { status: 'saved' }
    },
    saveError,
    scannerMissing,
    update: (patch: Partial<FileScanPolicy>) => {
      setDraft({ ...current, ...patch })
      setScannerMissing(false)
      resetSaveError()
    },
  }
}
