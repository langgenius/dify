import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ChatPreviewCard from './components/chat-preview-card'
import WorkflowPreviewCard from './components/workflow-preview-card'
import useWebAppBrand from './hooks/use-web-app-brand'

const ALLOW_FILE_EXTENSIONS = ['svg', 'png']

const CustomWebAppBrand = () => {
  const brandSwitchId = useId()
  const logoInputId = useId()
  const logoInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation(['appOverview', 'common', 'custom'])
  const {
    fileId,
    imgKey,
    uploadProgress,
    uploading,
    webappLogo,
    webappBrandRemoved,
    isCustomConfigUnavailable,
    uploadDisabled,
    workspaceLogo,
    canManageCustomBrand,
    canReplaceLogo,
    handleApply,
    handleCancel,
    handleChange,
    handleRestore,
    handleSwitch,
  } = useWebAppBrand()

  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between rounded-xl bg-background-section-burn p-4 system-md-medium text-text-primary">
        <label htmlFor={brandSwitchId}>{t(($) => $['webapp.removeBrand'], { ns: 'custom' })}</label>
        <Switch
          id={brandSwitchId}
          size="lg"
          checked={webappBrandRemoved ?? false}
          disabled={isCustomConfigUnavailable || !canReplaceLogo || !canManageCustomBrand}
          onCheckedChange={handleSwitch}
        />
      </div>
      <div
        className={cn(
          'flex min-h-14 flex-col items-start gap-3 rounded-xl bg-background-section-burn p-4 sm:flex-row sm:items-center sm:justify-between sm:py-2',
          webappBrandRemoved && 'opacity-30',
        )}
      >
        <div className="min-w-0 wrap-anywhere">
          <label htmlFor={logoInputId} className="block system-md-medium text-text-primary">
            {t(($) => $['webapp.changeLogo'], { ns: 'custom' })}
          </label>
          <div className="system-xs-regular text-text-tertiary">
            {t(($) => $['webapp.changeLogoTip'], { ns: 'custom' })}
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {!uploadDisabled && webappLogo && !webappBrandRemoved && (
            <>
              <Button
                variant="ghost"
                disabled={uploadDisabled || (!webappLogo && !webappBrandRemoved)}
                onClick={handleRestore}
              >
                {t(($) => $.restore, { ns: 'custom' })}
              </Button>
              <div className="h-5 w-px shrink-0 bg-divider-regular"></div>
            </>
          )}
          {!uploading && (
            <>
              <Button disabled={uploadDisabled} onClick={() => logoInputRef.current?.click()}>
                <span aria-hidden="true" className="i-ri-image-add-line size-4" />
                {webappLogo || fileId
                  ? t(($) => $.change, { ns: 'custom' })
                  : t(($) => $.upload, { ns: 'custom' })}
              </Button>
              <input
                ref={logoInputRef}
                id={logoInputId}
                hidden
                onClick={(e) => ((e.target as HTMLInputElement).value = '')}
                type="file"
                accept={ALLOW_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
                onChange={handleChange}
                disabled={uploadDisabled}
              />
            </>
          )}
          {uploading && (
            <Button className="relative" disabled={true}>
              <span className="i-ri-loader-2-line size-4 animate-spin" />
              {t(($) => $.uploading, { ns: 'custom' })}
            </Button>
          )}
          {fileId && (
            <>
              <Button onClick={handleCancel} disabled={webappBrandRemoved || !canManageCustomBrand}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button
                variant="primary"
                onClick={handleApply}
                disabled={
                  isCustomConfigUnavailable ||
                  !canReplaceLogo ||
                  webappBrandRemoved ||
                  !canManageCustomBrand
                }
              >
                {t(($) => $.apply, { ns: 'custom' })}
              </Button>
            </>
          )}
        </div>
      </div>
      {uploadProgress === -1 && (
        <div className="mt-2 text-xs text-[#D92D20]">
          {t(($) => $.uploadedFail, { ns: 'custom' })}
        </div>
      )}
      <div className="mt-5 mb-2 flex items-center gap-2">
        <div className="shrink-0 system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['overview.appInfo.preview'], { ns: 'appOverview' })}
        </div>
        <Separator decorative variant="gradient" className="my-2 h-[0.5px] grow" />
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
