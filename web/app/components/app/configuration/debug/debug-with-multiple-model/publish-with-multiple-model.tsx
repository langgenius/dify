import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelAndParameter } from '../types'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { useProviderContext } from '@/context/provider-context'
import type { ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'

type PublishWithMultipleModelProps = {
  multipleModelConfigs: ModelAndParameter[]
  onSelect: (v: ModelAndParameter) => void
}
const PublishWithMultipleModel: FC<PublishWithMultipleModelProps> = ({
  multipleModelConfigs,
  onSelect,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const { textGenerationModelList } = useProviderContext()
  const [open, setOpen] = useState(false)

  const validModelConfigs: (ModelAndParameter & { modelItem: ModelItem })[] = []

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
      <PortalToFollowElemTrigger onClick={handleToggle}>
        <Button
          type='primary'
          disabled={!validModelConfigs.length}
          className='pl-3 pr-2 h-8 text-[13px]'
        >
          {t('appDebug.operation.applyConfig')}
          <ChevronDown className='ml-0.5 w-3 h-3' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-1 w-[168px] rounded-lg border-[0.5px] border-gray-200 shadow-lg bg-white'>
          <div className='flex items-center px-3 h-[22px] text-xs font-medium text-gray-500'>
            {t('appDebug.publishAs')}
          </div>
          {
            validModelConfigs.map((item, index) => (
              <div
                key={item.id}
                className='flex items-center px-3 h-8 rounded-lg hover:bg-gray-100 cursor-pointer text-sm text-gray-500'
                onClick={() => handleSelect(item)}
              >
                #{index + 1}
                <div
                  className='ml-1 text-gray-700 truncate'
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
