import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider } from '../declarations'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AddCustomModel,
  ManageCustomModelCredentials,
} from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '../declarations'
import { useLazyModelProviderDetail, useModelModalHandler } from '../hooks'

type ProviderSummary = ModelProviderSummaryResponse | ModelProvider

export default function LazyCustomModelActions({ provider }: { provider: ProviderSummary }) {
  const { t } = useTranslation()
  const handleOpenModelModal = useModelModalHandler()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isManageOpen, setIsManageOpen] = useState(false)
  const { providerDetail, loadProviderDetail, isLoadingProviderDetail } =
    useLazyModelProviderDetail(provider.provider)
  const hasCustomModels =
    'has_custom_models' in provider.custom_configuration
      ? provider.custom_configuration.has_custom_models
      : !!provider.custom_configuration.custom_models?.length

  const handleAddClick = async () => {
    const detail = await loadProviderDetail()
    if (!detail) return

    if (detail.custom_configuration.can_added_models?.length) {
      setIsAddOpen(true)
      return
    }

    handleOpenModelModal(detail, ConfigurationMethodEnum.customizableModel, undefined, {
      isModelCredential: true,
      mode: ModelModalModeEnum.configCustomModel,
    })
  }

  const handleManageClick = async () => {
    const detail = await loadProviderDetail()
    if (!detail) return

    setIsManageOpen(true)
  }

  if (providerDetail) {
    return (
      <>
        {hasCustomModels && (
          <ManageCustomModelCredentials
            provider={providerDetail}
            currentCustomConfigurationModelFixedFields={undefined}
            isOpen={isManageOpen}
            onOpenChange={setIsManageOpen}
          />
        )}
        <AddCustomModel
          provider={providerDetail}
          configurationMethod={ConfigurationMethodEnum.customizableModel}
          currentCustomConfigurationModelFixedFields={undefined}
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
        />
      </>
    )
  }

  return (
    <>
      {hasCustomModels && (
        <Button
          variant="ghost"
          size="small"
          loading={isLoadingProviderDetail}
          onClick={handleManageClick}
          className="mr-0.5 text-text-tertiary"
        >
          {t(($) => $['modelProvider.auth.manageCredentials'], { ns: 'common' })}
        </Button>
      )}
      <Button
        variant="ghost"
        size="small"
        loading={isLoadingProviderDetail}
        onClick={handleAddClick}
        className="text-text-tertiary"
      >
        <span className="mr-1 i-ri-add-circle-fill size-3.5" />
        {t(($) => $['modelProvider.addModel'], { ns: 'common' })}
      </Button>
    </>
  )
}
