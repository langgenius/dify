import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getImageUploadErrorMessage, imageUpload } from '@/app/components/base/image-uploader/utils'
import { toast } from '@/app/components/base/ui/toast'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useProviderContext } from '@/context/provider-context'
import { updateCurrentWorkspace } from '@/service/common'

const MAX_LOGO_FILE_SIZE = 5 * 1024 * 1024
const CUSTOM_CONFIG_URL = '/workspaces/custom-config'
const WEB_APP_LOGO_UPLOAD_URL = '/workspaces/custom-config/webapp-logo/upload'
const useWebAppBrand = () => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const { currentWorkspace, mutateCurrentWorkspace, isCurrentWorkspaceManager } = useAppContext()
  const [fileId, setFileId] = useState('')
  const [imgKey, setImgKey] = useState(() => Date.now())
  const [uploadProgress, setUploadProgress] = useState(0)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const isSandbox = enableBilling && plan.type === Plan.sandbox
  const uploading = uploadProgress > 0 && uploadProgress < 100
  const webappLogo = currentWorkspace.custom_config?.replace_webapp_logo || ''
  const webappBrandRemoved = currentWorkspace.custom_config?.remove_webapp_brand
  const uploadDisabled = isSandbox || webappBrandRemoved || !isCurrentWorkspaceManager
  const workspaceLogo = systemFeatures.branding.enabled ? systemFeatures.branding.workspace_logo : ''
  const persistWorkspaceBrand = async (body: Record<string, unknown>) => {
    await updateCurrentWorkspace({
      url: CUSTOM_CONFIG_URL,
      body,
    })
    mutateCurrentWorkspace()
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file)
      return
    if (file.size > MAX_LOGO_FILE_SIZE) {
      toast.error(t('imageUploader.uploadFromComputerLimit', { ns: 'common', size: 5 }))
      return
    }
    imageUpload({
      file,
      onProgressCallback: setUploadProgress,
      onSuccessCallback: (res) => {
        setUploadProgress(100)
        setFileId(res.id)
      },
      onErrorCallback: (error) => {
        const errorMessage = getImageUploadErrorMessage(error, t('imageUploader.uploadFromComputerUploadError', { ns: 'common' }), t)
        toast.error(errorMessage)
        setUploadProgress(-1)
      },
    }, false, WEB_APP_LOGO_UPLOAD_URL)
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
    uploadDisabled,
    workspaceLogo,
    isSandbox,
    isCurrentWorkspaceManager,
    handleApply,
    handleCancel,
    handleChange,
    handleRestore,
    handleSwitch,
  }
}
export default useWebAppBrand
