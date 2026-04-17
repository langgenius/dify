import type { CSSProperties, FC } from 'react'
import type { ModelAndParameter } from '../types'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
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
  const [open, setOpen] = useState(false)

  const handleDuplicate = () => {
    setOpen(false)
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

  const handleDebugAsSingleModel = () => {
    setOpen(false)
    onDebugWithMultipleModelChange(modelAndParameter)
  }

  const handleRemove = () => {
    setOpen(false)
    onMultipleModelConfigsChange(
      true,
      multipleModelConfigs.filter(item => item.id !== modelAndParameter.id),
    )
  }

  const showDuplicate = multipleModelConfigs.length <= 3
  const showDebugAsSingleModel = !!(modelAndParameter.provider && modelAndParameter.model)
  const showRemove = multipleModelConfigs.length > 2

  return (
    <div
      className={`flex min-w-[320px] flex-col rounded-xl bg-background-section-burn ${className}`}
      style={style}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b-[0.5px] border-divider-regular px-3">
        <div className="flex h-5 w-6 items-center justify-center font-medium text-text-tertiary italic">
          #
          {index + 1}
        </div>
        <ModelParameterTrigger
          modelAndParameter={modelAndParameter}
        />
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger render={<div />}>
            <ActionButton className={open ? 'bg-state-base-hover' : ''}>
              <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
            </ActionButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-end"
            sideOffset={4}
            popupClassName="min-w-[160px]"
          >
            {showDuplicate && (
              <DropdownMenuItem className="system-md-regular" onClick={handleDuplicate}>
                {t('duplicateModel', { ns: 'appDebug' })}
              </DropdownMenuItem>
            )}
            {showDebugAsSingleModel && (
              <DropdownMenuItem className="system-md-regular" onClick={handleDebugAsSingleModel}>
                {t('debugAsSingleModel', { ns: 'appDebug' })}
              </DropdownMenuItem>
            )}
            {showRemove && (
              <>
                {(showDuplicate || showDebugAsSingleModel) && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" className="system-md-regular" onClick={handleRemove}>
                  {t('operation.remove', { ns: 'common' })}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
