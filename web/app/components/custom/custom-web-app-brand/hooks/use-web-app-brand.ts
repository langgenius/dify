import type { WorkspaceCustomConfigPayload } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ChangeEvent } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getImageUploadErrorMessage, imageUpload } from '@/app/components/base/image-uploader/utils'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'

const MAX_LOGO_FILE_SIZE = 5 * 1024 * 1024
const WEB_APP_LOGO_UPLOAD_URL = '/workspaces/custom-config/webapp-logo/upload'
const useWebAppBrand = () => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const queryClient = useQueryClient()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const [fileId, setFileId] = useState('')
  const [imgKey, setImgKey] = useState(() => Date.now())
  const [uploadProgress, setUploadProgress] = useState(0)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const customConfigQuery = useQuery(consoleQuery.workspaces.customConfig.get.queryOptions())
  const { data: customConfig } = customConfigQuery
  const updateCustomConfigMutation = useMutation(
    consoleQuery.workspaces.customConfig.post.mutationOptions(),
  )
  const isSandbox = enableBilling && plan.type === 'sandbox'
  const uploading = uploadProgress > 0 && uploadProgress < 100
  const webappLogo = customConfig?.replace_webapp_logo || ''
  const webappBrandRemoved = customConfig?.remove_webapp_brand ?? undefined
  const canManageCustomBrand = hasPermission(workspacePermissionKeys, 'customization.manage')
  const isCustomConfigUnavailable = customConfigQuery.isPending || customConfigQuery.isError
  const uploadDisabled =
    isCustomConfigUnavailable || isSandbox || webappBrandRemoved || !canManageCustomBrand
  const workspaceLogo = systemFeatures.branding.enabled
    ? systemFeatures.branding.workspace_logo
    : ''
  const persistWorkspaceBrand = async (body: WorkspaceCustomConfigPayload) => {
    await updateCustomConfigMutation.mutateAsync({ body })
    await queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.customConfig.get.key(),
    })
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_LOGO_FILE_SIZE) {
      toast.error(t(($) => $['imageUploader.uploadFromComputerLimit'], { ns: 'common', size: 5 }))
      return
    }
    imageUpload(
      {
        file,
        onProgressCallback: setUploadProgress,
        onSuccessCallback: (res) => {
          setUploadProgress(100)
          setFileId(res.id)
        },
        onErrorCallback: (error) => {
          const errorMessage = getImageUploadErrorMessage(
            error,
            t(($) => $['imageUploader.uploadFromComputerUploadError'], { ns: 'common' }),
            t,
          )
          toast.error(errorMessage)
          setUploadProgress(-1)
        },
      },
      false,
      WEB_APP_LOGO_UPLOAD_URL,
    )
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
    uploadDisabled,
    workspaceLogo,
    isSandbox,
    canManageCustomBrand,
    handleApply,
    handleCancel,
    handleChange,
    handleRestore,
    handleSwitch,
  }
}
export default useWebAppBrand
