import type {
  ProviderModelWithStatusEntity,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { FC } from 'react'
import type { ModelAndParameter } from '../configuration/debug/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { renderI18nObject } from '@/i18n-config'
import { consoleQuery } from '@/service/console'
import ModelIcon from '../../header/account-setting/model-provider-page/model-icon'

type PublishWithMultipleModelProps = {
  disabled?: boolean
  multipleModelConfigs: ModelAndParameter[]
  onSelect: (v: ModelAndParameter) => void
}
const PublishWithMultipleModel: FC<PublishWithMultipleModelProps> = ({
  disabled = false,
  multipleModelConfigs,
  onSelect,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const { data: textGenerationModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )
  const [open, setOpen] = useState(false)

  const validModelConfigs: (ModelAndParameter & {
    modelItem: ProviderModelWithStatusEntity
    providerItem: ProviderWithModelsResponse
  })[] = []

  multipleModelConfigs.forEach((item) => {
    const provider = textGenerationModelList.find((model) => model.provider === item.provider)

    if (provider) {
      const model = provider.models.find((model) => model.model === item.model)

      if (model) {
        validModelConfigs.push({
          id: item.id,
          model: item.model,
          provider: item.provider,
          modelItem: model,
          providerItem: provider,
          parameters: item.parameters,
        })
      }
    }
  })

  const triggerDisabled = disabled || !validModelConfigs.length

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={triggerDisabled}
        render={<Button variant="primary" disabled={triggerDisabled} className="w-full" />}
      >
        <>
          {t(($) => $['operation.applyConfig'], { ns: 'appDebug' })}
          <RiArrowDownSLine className="size-3" />
        </>
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-[288px] p-1">
        <div className="flex h-5.5 items-center px-3 text-xs font-medium text-text-tertiary">
          {t(($) => $.publishAs, { ns: 'appDebug' })}
        </div>
        {validModelConfigs.map((item, index) => (
          <DropdownMenuItem key={item.id} className="gap-0 px-3" onClick={() => onSelect(item)}>
            <span className="min-w-4.5 italic">#{index + 1}</span>
            <ModelIcon modelName={item.model} provider={item.providerItem} className="ml-2" />
            <div
              className="ml-1 truncate text-text-secondary"
              title={renderI18nObject(item.modelItem.label, language)}
            >
              {renderI18nObject(item.modelItem.label, language)}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PublishWithMultipleModel
