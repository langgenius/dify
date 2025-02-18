import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import type { ModelAndParameter } from '../configuration/debug/types'
import ModelIcon from '../../header/account-setting/model-provider-page/model-icon'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useProviderContext } from '@/context/provider-context'
import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'

type PublishWithMultipleModelProps = {
  multipleModelConfigs: ModelAndParameter[]
  // textGenerationModelList?: Model[]
  onSelect: (v: ModelAndParameter) => void
}
const PublishWithMultipleModel: FC<PublishWithMultipleModelProps> = ({
  multipleModelConfigs,
  // textGenerationModelList = [],
  onSelect,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const { textGenerationModelList } = useProviderContext()
  const [open, setOpen] = useState(false)

  const validModelConfigs: (ModelAndParameter & { modelItem: ModelItem; providerItem: Model })[] = []

  multipleModelConfigs.forEach((item) => {
    const provider = textGenerationModelList.find(model => model.provider === item.provider)

    if (provider) {
      const model = provider.models.find(model => model.model === item.model)

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

  const handleToggle = () => {
    if (validModelConfigs.length)
      setOpen(v => !v)
  }

  const handleSelect = (item: ModelAndParameter) => {
    onSelect(item)
    setOpen(false)
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
    >
      <PortalToFollowElemTrigger className='w-full' onClick={handleToggle}>
        <Button
          variant='primary'
          disabled={!validModelConfigs.length}
          className='mt-3 w-full'
        >
          {t('appDebug.operation.applyConfig')}
          <RiArrowDownSLine className='ml-0.5 h-3 w-3' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50 mt-1 w-[288px]'>
        <div className='border-components-panel-border bg-components-panel-bg rounded-lg border-[0.5px] p-1 shadow-lg'>
          <div className='text-text-tertiary flex h-[22px] items-center px-3 text-xs font-medium'>
            {t('appDebug.publishAs')}
          </div>
          {
            validModelConfigs.map((item, index) => (
              <div
                key={item.id}
                className='text-text-tertiary hover:bg-state-base-hover flex h-8 cursor-pointer items-center rounded-lg px-3 text-sm'
                onClick={() => handleSelect(item)}
              >
                <span className='min-w-[18px] italic'>#{index + 1}</span>
                <ModelIcon modelName={item.model} provider={item.providerItem} className='ml-2' />
                <div
                  className='text-text-secondary ml-1 truncate'
                  title={item.modelItem.label[language]}
                >
                  {item.modelItem.label[language]}
                </div>
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default PublishWithMultipleModel
