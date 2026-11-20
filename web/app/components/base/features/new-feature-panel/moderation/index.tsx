import type { OnFeaturesChange } from '@/app/components/base/features/types'
import type { ModerationConfig } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { createDialogHandle, Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { RiEqualizer2Line } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { codeBasedExtensionsQueryOptions } from '@/service/console/code-based-extension-query'
import { ModerationDialogContent } from './dialog-content'

type Props = Readonly<{
  disabled?: boolean
  onChange?: OnFeaturesChange
}>

const Moderation = ({ disabled, onChange }: Props) => {
  const { t } = useTranslation(['appDebug', 'common'])
  const [dialog] = useState(() => createDialogHandle<ModerationConfig>())
  const locale = useLocale()
  const featuresStore = useFeaturesStore()
  const moderation = useFeatures((s) => s.features.moderation)
  const { data: codeBasedExtensionList } = useQuery(codeBasedExtensionsQueryOptions('moderation'))

  function updateModeration(value: ModerationConfig) {
    const { features, setFeatures } = featuresStore!.getState()
    const next = { ...features, moderation: value }
    setFeatures(next)
    onChange?.(next)
  }

  function changeEnabled(enabled: boolean) {
    if (enabled && !moderation?.type) {
      dialog.openWithPayload({
        enabled: true,
        type: 'keywords',
        config: { keywords: '', inputs_config: { enabled: true, preset_response: '' } },
      })
    } else {
      updateModeration(enabled ? { ...moderation, enabled } : { enabled })
    }
  }

  const providerContent = useMemo(() => {
    if (moderation?.type === 'openai_moderation')
      return t(($) => $['feature.moderation.modal.provider.openai'], { ns: 'appDebug' })
    else if (moderation?.type === 'keywords')
      return t(($) => $['feature.moderation.modal.provider.keywords'], { ns: 'appDebug' })
    else if (moderation?.type === 'api')
      return t(($) => $['apiBasedExtension.selector.title'], { ns: 'common' })
    else
      return (
        codeBasedExtensionList?.data.find((item) => item.name === moderation?.type)?.label[
          locale
        ] || '-'
      )
  }, [codeBasedExtensionList?.data, locale, moderation?.type, t])

  const enableContent = useMemo(() => {
    if (moderation?.config?.inputs_config?.enabled && moderation.config?.outputs_config?.enabled)
      return t(($) => $['feature.moderation.allEnabled'], { ns: 'appDebug' })
    else if (moderation?.config?.inputs_config?.enabled)
      return t(($) => $['feature.moderation.inputEnabled'], { ns: 'appDebug' })
    else if (moderation?.config?.outputs_config?.enabled)
      return t(($) => $['feature.moderation.outputEnabled'], { ns: 'appDebug' })
  }, [moderation?.config?.inputs_config?.enabled, moderation?.config?.outputs_config?.enabled, t])

  return (
    <>
      <FeatureCard
        icon={
          <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-text-success p-1 shadow-xs">
            <span
              aria-hidden
              className="i-custom-vender-features-content-moderation size-4 text-text-primary-on-surface"
            />
          </div>
        }
        title={t(($) => $['feature.moderation.title'], { ns: 'appDebug' })}
        value={!!moderation?.enabled}
        onChange={changeEnabled}
        disabled={disabled}
      >
        <>
          {!moderation?.enabled && (
            <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
              {t(($) => $['feature.moderation.description'], { ns: 'appDebug' })}
            </div>
          )}
          {!!moderation?.enabled && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-4 pt-0.5">
                <div className="">
                  <div className="mb-0.5 system-2xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['feature.moderation.modal.provider.title'], { ns: 'appDebug' })}
                  </div>
                  <div className="system-xs-regular text-text-secondary">{providerContent}</div>
                </div>
                <div className="h-6.75 w-px rotate-12 bg-divider-subtle"></div>
                <div className="">
                  <div className="mb-0.5 system-2xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['feature.moderation.contentEnableLabel'], { ns: 'appDebug' })}
                  </div>
                  <div className="system-xs-regular text-text-secondary">{enableContent}</div>
                </div>
              </div>
              <DialogTrigger
                handle={dialog}
                payload={moderation}
                render={
                  <Button
                    className="shrink-0 group-hover/feature-card:opacity-100 focus-visible:opacity-100 pointer-fine:opacity-0"
                    disabled={disabled}
                  />
                }
              >
                <RiEqualizer2Line className="size-4" />
                {t(($) => $['operation.settings'], { ns: 'common' })}
              </DialogTrigger>
            </div>
          )}
        </>
      </FeatureCard>
      <Dialog handle={dialog} disablePointerDismissal>
        {({ payload }) =>
          payload && (
            <ModerationDialogContent
              data={payload}
              onSave={(value) => {
                updateModeration(value)
                dialog.close()
              }}
            />
          )
        }
      </Dialog>
    </>
  )
}

export default Moderation
