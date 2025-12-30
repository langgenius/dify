import type { CSSProperties, FC } from 'react'
import type { ModelAndParameter } from '../types'
import type { Item } from '@/app/components/base/dropdown'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Dropdown from '@/app/components/base/dropdown'
import { ModelStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { useProviderContext } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import ChatItem from './chat-item'
import { useDebugWithMultipleModelContext } from './context'
import ModelParameterTrigger from './model-parameter-trigger'
import TextGenerationItem from './text-generation-item'

type DebugItemProps = {
  modelAndParameter: ModelAndParameter
  className?: string
  style?: CSSProperties
}
const DebugItem: FC<DebugItemProps> = ({
  modelAndParameter,
  className,
  style,
}) => {
  const { t } = useTranslation()
  const { mode } = useDebugConfigurationContext()
  const {
    multipleModelConfigs,
    onMultipleModelConfigsChange,
    onDebugWithMultipleModelChange,
  } = useDebugWithMultipleModelContext()
  const { textGenerationModelList } = useProviderContext()

  const index = multipleModelConfigs.findIndex(v => v.id === modelAndParameter.id)
  const currentProvider = textGenerationModelList.find(item => item.provider === modelAndParameter.provider)
  const currentModel = currentProvider?.models.find(item => item.model === modelAndParameter.model)

  const handleSelect = (item: Item) => {
    if (item.value === 'duplicate') {
      if (multipleModelConfigs.length >= 4)
        return

      onMultipleModelConfigsChange(
        true,
        [
          ...multipleModelConfigs.slice(0, index + 1),
          {
            ...modelAndParameter,
            id: `${Date.now()}`,
          },
          ...multipleModelConfigs.slice(index + 1),
        ],
      )
    }
    if (item.value === 'debug-as-single-model')
      onDebugWithMultipleModelChange(modelAndParameter)
    if (item.value === 'remove') {
      onMultipleModelConfigsChange(
        true,
        multipleModelConfigs.filter(item => item.id !== modelAndParameter.id),
      )
    }
  }

  return (
    <div
      className={`flex min-w-[320px] flex-col rounded-xl bg-background-section-burn ${className}`}
      style={style}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b-[0.5px] border-divider-regular px-3">
        <div className="flex h-5 w-6 items-center justify-center font-medium italic text-text-tertiary">
          #
          {index + 1}
        </div>
        <ModelParameterTrigger
          modelAndParameter={modelAndParameter}
        />
        <Dropdown
          onSelect={handleSelect}
          items={[
            ...(
              multipleModelConfigs.length <= 3
                ? [
                    {
                      value: 'duplicate',
                      text: t('duplicateModel', { ns: 'appDebug' }),
                    },
                  ]
                : []
            ),
            ...(
              (modelAndParameter.provider && modelAndParameter.model)
                ? [
                    {
                      value: 'debug-as-single-model',
                      text: t('debugAsSingleModel', { ns: 'appDebug' }),
                    },
                  ]
                : []
            ),
          ]}
          secondItems={
            multipleModelConfigs.length > 2
              ? [
                  {
                    value: 'remove',
                    text: t('operation.remove', { ns: 'common' }) as string,
                  },
                ]
              : undefined
          }
        />
      </div>
      <div style={{ height: 'calc(100% - 40px)' }}>
        {
          (mode === AppModeEnum.CHAT || mode === AppModeEnum.AGENT_CHAT) && currentProvider && currentModel && currentModel.status === ModelStatusEnum.active && (
            <ChatItem modelAndParameter={modelAndParameter} />
          )
        }
        {
          mode === AppModeEnum.COMPLETION && currentProvider && currentModel && currentModel.status === ModelStatusEnum.active && (
            <TextGenerationItem modelAndParameter={modelAndParameter} />
          )
        }
      </div>
    </div>
  )
}

export default memo(DebugItem)
