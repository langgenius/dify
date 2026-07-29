import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider } from '../declarations'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddCustomModel } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '../declarations'
import { useLazyModelProviderDetail, useModelModalHandler } from '../hooks'

type ProviderSummary = ModelProviderSummaryResponse | ModelProvider

export default function LazyAddCustomModel({ provider }: { provider: ProviderSummary }) {
  const { t } = useTranslation()
  const handleOpenModelModal = useModelModalHandler()
  const [open, setOpen] = useState(false)
  const { providerDetail, loadProviderDetail, isLoadingProviderDetail } =
    useLazyModelProviderDetail(provider.provider)

  const handleClick = async () => {
    const detail = await loadProviderDetail()
    if (!detail) return

    if (detail.custom_configuration.can_added_models?.length) {
      setOpen(true)
      return
    }

    handleOpenModelModal(detail, ConfigurationMethodEnum.customizableModel, undefined, {
      isModelCredential: true,
      mode: ModelModalModeEnum.configCustomModel,
    })
  }

  if (providerDetail) {
    return (
      <AddCustomModel
        provider={providerDetail}
        configurationMethod={ConfigurationMethodEnum.customizableModel}
        currentCustomConfigurationModelFixedFields={undefined}
        open={open}
        onOpenChange={setOpen}
      />
    )
  }

  return (
    <Button
      variant="ghost"
      size="small"
      loading={isLoadingProviderDetail}
      onClick={handleClick}
      className="text-text-tertiary"
    >
      <span className="mr-1 i-ri-add-circle-fill size-3.5" />
      {t(($) => $['modelProvider.addModel'], { ns: 'common' })}
    </Button>
  )
}
