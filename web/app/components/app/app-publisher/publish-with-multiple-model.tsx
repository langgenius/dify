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
          <RiArrowDownSLine className='ml-0.5 w-3 h-3' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='mt-1 w-[288px] z-50'>
        <div className='p-1 rounded-lg border-[0.5px] border-components-panel-border shadow-lg bg-components-panel-bg'>
          <div className='flex items-center px-3 h-[22px] text-xs font-medium text-text-tertiary'>
            {t('appDebug.publishAs')}
          </div>
          {
            validModelConfigs.map((item, index) => (
              <div
                key={item.id}
                className='flex items-center h-8 px-3 text-sm text-text-tertiary rounded-lg cursor-pointer hover:bg-state-base-hover'
                onClick={() => handleSelect(item)}
              >
                <span className='italic min-w-[18px]'>#{index + 1}</span>
                <ModelIcon modelName={item.model} provider={item.providerItem} className='ml-2' />
                <div
                  className='ml-1 text-text-secondary truncate'
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
