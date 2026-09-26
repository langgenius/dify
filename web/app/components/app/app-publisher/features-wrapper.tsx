import type {
  AppPublisherProps,
  AppPublisherPublishOptions,
  AppPublisherPublishParams,
} from '@/app/components/app/app-publisher/types'
import type { ConfigurationPublishConfig } from '@/app/components/app/configuration/hooks/configuration-lifecycle/types'
import type { Features } from '@/app/components/base/features/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppPublisher } from '@/app/components/app/app-publisher'
import { toast } from '@/app/components/app/configuration/toast'
import { buildConfigurationFeaturesData } from '@/app/components/app/configuration/utils'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'

type Props = Omit<AppPublisherProps, 'onPublish'> & {
  onPublish?: (
    params?: AppPublisherPublishParams,
    features?: Features,
    options?: AppPublisherPublishOptions,
  ) => Promise<unknown> | unknown
  loadPublishedConfig: () => Promise<ConfigurationPublishConfig>
  resetAppConfig: (config: ConfigurationPublishConfig) => void
}

const FeaturesWrappedAppPublisher = (props: Props) => {
  const { t } = useTranslation(['appDebug', 'common'])
  const features = useFeatures((s) => s.features)
  const featuresStore = useFeaturesStore()
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const { mutate: restore, isPending: isRestoring } = useMutation({
    mutationFn: props.loadPublishedConfig,
  })

  const applyPublishedConfig = (config: ConfigurationPublishConfig) => {
    props.resetAppConfig(config)
    const { features, setFeatures } = featuresStore!.getState()
    setFeatures(buildConfigurationFeaturesData(config.modelConfig, features.file?.fileUploadConfig))
    setRestoreConfirmOpen(false)
  }

  const handleConfirm = () => {
    restore(undefined, {
      onSuccess: applyPublishedConfig,
      onError: () => toast.error(t(($) => $['api.actionFailed'], { ns: 'common' })),
    })
  }

  const handlePublish = useCallback(
    (params?: AppPublisherPublishParams, options?: AppPublisherPublishOptions) => {
      if (options) return props.onPublish?.(params, features, options)
      return props.onPublish?.(params, features)
    },
    [features, props],
  )

  return (
    <>
      <AppPublisher
        {...{
          ...props,
          onPublish: handlePublish,
          onRestore: () => setRestoreConfirmOpen(true),
        }}
      />
      <AlertDialog
        open={restoreConfirmOpen}
        onOpenChange={(open) => !open && !isRestoring && setRestoreConfirmOpen(false)}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['resetConfig.title'], { ns: 'appDebug' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['resetConfig.message'], { ns: 'appDebug' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={isRestoring}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleConfirm} loading={isRestoring}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default FeaturesWrappedAppPublisher
