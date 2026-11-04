import type { CSSProperties, FC } from 'react'
import type { ModelAndParameter } from '../types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { consoleQuery } from '@/service/console'
import ChatItem from './chat-item'
import { useDebugWithMultipleModelContext } from './context'
import ModelParameterTrigger from './model-parameter-trigger'
import TextGenerationItem from './text-generation-item'

type DebugItemProps = {
  modelAndParameter: ModelAndParameter
  className?: string
  style?: CSSProperties
}
const DebugItem: FC<DebugItemProps> = ({ modelAndParameter, className, style }) => {
  const { t } = useTranslation(['appDebug', 'common'])
  const { mode } = useDebugConfigurationContext()
  const { multipleModelConfigs, onMultipleModelConfigsChange, onDebugWithMultipleModelChange } =
    useDebugWithMultipleModelContext()
  const { data: textGenerationModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )

  const index = multipleModelConfigs.findIndex((v) => v.id === modelAndParameter.id)
  const currentProvider = textGenerationModelList.find(
    (item) => item.provider === modelAndParameter.provider,
  )
  const currentModel = currentProvider?.models.find(
    (item) => item.model === modelAndParameter.model,
  )

  const handleDuplicate = () => {
    if (multipleModelConfigs.length >= 4) return

    onMultipleModelConfigsChange(true, [
      ...multipleModelConfigs.slice(0, index + 1),
      {
        ...modelAndParameter,
        id: `${Date.now()}`,
      },
      ...multipleModelConfigs.slice(index + 1),
    ])
  }

  const handleDebugAsSingleModel = () => {
    onDebugWithMultipleModelChange(modelAndParameter)
  }

  const handleRemove = () => {
    onMultipleModelConfigsChange(
      true,
      multipleModelConfigs.filter((item) => item.id !== modelAndParameter.id),
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
          #{index + 1}
        </div>
        <ModelParameterTrigger modelAndParameter={modelAndParameter} />
        <Menu>
          <MenuTrigger
            render={
              <IconButton
                aria-label={t(($) => $['operation.more'], { ns: 'common' })}
                className="data-popup-open:bg-state-base-hover"
              >
                <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
              </IconButton>
            }
          />
          <MenuContent align="end" className="min-w-40">
            {showDuplicate && (
              <MenuItem className="system-md-regular" onClick={handleDuplicate}>
                {t(($) => $.duplicateModel, { ns: 'appDebug' })}
              </MenuItem>
            )}
            {showDebugAsSingleModel && (
              <MenuItem className="system-md-regular" onClick={handleDebugAsSingleModel}>
                {t(($) => $.debugAsSingleModel, { ns: 'appDebug' })}
              </MenuItem>
            )}
            {showRemove && (
              <>
                {(showDuplicate || showDebugAsSingleModel) && <MenuSeparator />}
                <MenuItem
                  variant="destructive"
                  className="system-md-regular"
                  onClick={handleRemove}
                >
                  {t(($) => $['operation.remove'], { ns: 'common' })}
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
      </div>
      <div style={{ height: 'calc(100% - 40px)' }}>
        {(mode === 'chat' || mode === 'agent-chat') &&
          currentProvider &&
          currentModel &&
          currentModel.status === ModelStatusEnum.active && (
            <ChatItem modelAndParameter={modelAndParameter} />
          )}
        {mode === 'completion' &&
          currentProvider &&
          currentModel &&
          currentModel.status === ModelStatusEnum.active && (
            <TextGenerationItem modelAndParameter={modelAndParameter} />
          )}
      </div>
    </div>
  )
}

export default memo(DebugItem)
