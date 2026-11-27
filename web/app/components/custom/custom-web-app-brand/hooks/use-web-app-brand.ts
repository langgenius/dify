import type { WorkspaceCustomConfigPayload } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ChangeEvent } from 'react'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleClient, consoleQuery } from '@/service/console'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { hasPermission } from '@/utils/permission'

const MAX_LOGO_FILE_SIZE = 5 * 1024 * 1024
const useWebAppBrand = () => {
  const { t } = useTranslation(['common'])
  const describeRequestError = useRequestErrorDescriber()
  const featuresQuery = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (data) => data.can_replace_logo,
    }),
  )
  const { data: canReplaceLogo } = featuresQuery
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const [fileId, setFileId] = useState('')
  const [imgKey, setImgKey] = useState(() => Date.now())
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const customConfigQuery = useQuery(consoleQuery.workspaces.customConfig.get.queryOptions())
  const { data: customConfig } = customConfigQuery
  const updateCustomConfigMutation = useMutation(
    consoleQuery.workspaces.customConfig.post.mutationOptions(),
  )
  const webappLogo = customConfig?.replace_webapp_logo || ''
  const webappBrandRemoved = customConfig?.remove_webapp_brand ?? undefined
  const canManageCustomBrand = hasPermission(workspacePermissionKeys, 'customization.manage')
  const isCustomConfigUnavailable = customConfig === undefined || canReplaceLogo === undefined
  // The controls stay disabled until both reads load, so a failed first load says why. The only
  // caller renders it, so it is claimed here.
  const customConfigLoad = useOwnedQueryErrors([customConfigQuery, featuresQuery])
  const customConfigLoadError = customConfigLoad?.error
  const customConfigRetrying = customConfigLoad?.retrying ?? false
  const retryCustomConfig = () => customConfigLoad?.retry()
  const uploadDisabled =
    isCustomConfigUnavailable || !canReplaceLogo || webappBrandRemoved || !canManageCustomBrand
  const workspaceLogo = systemFeatures.branding.enabled
    ? systemFeatures.branding.workspace_logo
    : ''
  const persistWorkspaceBrand = async (body: WorkspaceCustomConfigPayload) => {
    if (isCustomConfigUnavailable || !canReplaceLogo || !canManageCustomBrand) return
    await updateCustomConfigMutation.mutateAsync({ body })
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (uploadDisabled || uploading) return
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_LOGO_FILE_SIZE) {
      toast.error(t(($) => $['imageUploader.uploadFromComputerLimit'], { ns: 'common', size: 5 }))
      return
    }
    setUploadProgress(0)
    setUploading(true)
    consoleClient.workspaces.customConfig.webappLogo.upload
      .post(
        { body: { file } },
        {
          context: {
            onUploadProgress: ({ loaded, total }) => {
              setUploadProgress(Math.floor((loaded / total) * 100))
            },
          },
        },
      )
      .then((res) => {
        setUploadProgress(100)
        setFileId(res.id)
        setUploading(false)
      })
      .catch((error: unknown) => {
        const errorMessage = describeRequestError(
          error,
          t(($) => $['imageUploader.uploadFromComputerUploadError'], { ns: 'common' }),
        )
        toast.error(errorMessage)
        setUploadProgress(-1)
        setUploading(false)
      })
  }
  const handleApply = async () => {
    await persistWorkspaceBrand({
      remove_webapp_brand: webappBrandRemoved,
      replace_webapp_logo: fileId,
    })
    setFileId('')
    setImgKey(Date.now())
  }
  const handleRestore = async () => {
    await persistWorkspaceBrand({
      remove_webapp_brand: false,
      replace_webapp_logo: '',
    })
  }
  const handleSwitch = async (checked: boolean) => {
    await persistWorkspaceBrand({
      remove_webapp_brand: checked,
    })
  }
  const handleCancel = () => {
    setFileId('')
    setUploadProgress(0)
  }
  return {
    fileId,
    imgKey,
    uploadProgress,
    uploading,
    webappLogo,
    webappBrandRemoved,
    isCustomConfigUnavailable,
    customConfigLoadError,
    customConfigRetrying,
    retryCustomConfig,
    uploadDisabled,
    workspaceLogo,
    canReplaceLogo,
    canManageCustomBrand,
    handleApply,
    handleCancel,
    handleChange,
    handleRestore,
    handleSwitch,
  }
}
export default useWebAppBrand
