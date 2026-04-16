import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Switch from '@/app/components/base/switch'
import { Button } from '@/app/components/base/ui/button'
import ChatPreviewCard from './components/chat-preview-card'
import WorkflowPreviewCard from './components/workflow-preview-card'
import useWebAppBrand from './hooks/use-web-app-brand'

const ALLOW_FILE_EXTENSIONS = ['svg', 'png']

const CustomWebAppBrand = () => {
  const { t } = useTranslation()
  const {
    fileId,
    imgKey,
    uploadProgress,
    uploading,
    webappLogo,
    webappBrandRemoved,
    uploadDisabled,
    workspaceLogo,
    isCurrentWorkspaceManager,
    isSandbox,
    handleApply,
    handleCancel,
    handleChange,
    handleRestore,
    handleSwitch,
  } = useWebAppBrand()

  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between rounded-xl bg-background-section-burn p-4 system-md-medium text-text-primary">
        {t('webapp.removeBrand', { ns: 'custom' })}
        <Switch
          size="lg"
          checked={webappBrandRemoved ?? false}
          disabled={isSandbox || !isCurrentWorkspaceManager}
          onCheckedChange={handleSwitch}
        />
      </div>
      <div className={cn('flex h-14 items-center justify-between rounded-xl bg-background-section-burn px-4', webappBrandRemoved && 'opacity-30')}>
        <div>
          <div className="system-md-medium text-text-primary">{t('webapp.changeLogo', { ns: 'custom' })}</div>
          <div className="system-xs-regular text-text-tertiary">{t('webapp.changeLogoTip', { ns: 'custom' })}</div>
        </div>
        <div className="flex items-center">
          {(!uploadDisabled && webappLogo && !webappBrandRemoved) && (
            <>
              <Button
                variant="ghost"
                disabled={uploadDisabled || (!webappLogo && !webappBrandRemoved)}
                onClick={handleRestore}
              >
                {t('restore', { ns: 'custom' })}
              </Button>
              <div className="mx-2 h-5 w-px bg-divider-regular"></div>
            </>
          )}
          {
            !uploading && (
              <Button
                className="relative mr-2"
                disabled={uploadDisabled}
              >
                <span className="mr-1 i-ri-image-add-line h-4 w-4" />
                {
                  (webappLogo || fileId)
                    ? t('change', { ns: 'custom' })
                    : t('upload', { ns: 'custom' })
                }
                <input
                  className={cn('absolute inset-0 block w-full text-[0] opacity-0', uploadDisabled ? 'cursor-not-allowed' : 'cursor-pointer')}
                  onClick={e => (e.target as HTMLInputElement).value = ''}
                  type="file"
                  accept={ALLOW_FILE_EXTENSIONS.map(ext => `.${ext}`).join(',')}
                  onChange={handleChange}
                  disabled={uploadDisabled}
                />
              </Button>
            )
          }
          {
            uploading && (
              <Button
                className="relative mr-2"
                disabled={true}
              >
                <span className="mr-1 i-ri-loader-2-line h-4 w-4 animate-spin" />
                {t('uploading', { ns: 'custom' })}
              </Button>
            )
          }
          {
            fileId && (
              <>
                <Button
                  className="mr-2"
                  onClick={handleCancel}
                  disabled={webappBrandRemoved || !isCurrentWorkspaceManager}
                >
                  {t('operation.cancel', { ns: 'common' })}
                </Button>
                <Button
                  variant="primary"
                  className="mr-2"
                  onClick={handleApply}
                  disabled={webappBrandRemoved || !isCurrentWorkspaceManager}
                >
                  {t('apply', { ns: 'custom' })}
                </Button>
              </>
            )
          }
        </div>
      </div>
      {uploadProgress === -1 && (
        <div className="mt-2 text-xs text-[#D92D20]">{t('uploadedFail', { ns: 'custom' })}</div>
      )}
      <div className="mt-5 mb-2 flex items-center gap-2">
        <div className="shrink-0 system-xs-medium-uppercase text-text-tertiary">{t('overview.appInfo.preview', { ns: 'appOverview' })}</div>
        <Divider bgStyle="gradient" className="grow" />
      </div>
      <div className="relative mb-2 flex items-center gap-3">
        <ChatPreviewCard
          webappBrandRemoved={webappBrandRemoved}
          workspaceLogo={workspaceLogo}
          webappLogo={webappLogo}
          imgKey={imgKey}
        />
        <WorkflowPreviewCard
          webappBrandRemoved={webappBrandRemoved}
          workspaceLogo={workspaceLogo}
          webappLogo={webappLogo}
          imgKey={imgKey}
        />
      </div>
    </div>
  )
}

export default CustomWebAppBrand
