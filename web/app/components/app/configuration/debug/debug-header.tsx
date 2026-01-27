'use client'
import type { FC } from 'react'
import type { ModelAndParameter } from './types'
import {
  RiAddLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'
import TooltipPlus from '@/app/components/base/tooltip'
import { AppModeEnum } from '@/types/app'

type DebugHeaderProps = {
  readonly?: boolean
  mode: AppModeEnum
  debugWithMultipleModel: boolean
  multipleModelConfigs: ModelAndParameter[]
  varListLength: number
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onClearConversation: () => void
  onAddModel: () => void
}

const DebugHeader: FC<DebugHeaderProps> = ({
  readonly,
  mode,
  debugWithMultipleModel,
  multipleModelConfigs,
  varListLength,
  expanded,
  onExpandedChange,
  onClearConversation,
  onAddModel,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-3">
      <div className="system-xl-semibold text-text-primary">{t('inputs.title', { ns: 'appDebug' })}</div>
      <div className="flex items-center">
        {debugWithMultipleModel && (
          <>
            <Button
              variant="ghost-accent"
              onClick={onAddModel}
              disabled={multipleModelConfigs.length >= 4}
            >
              <RiAddLine className="mr-1 h-3.5 w-3.5" />
              {t('modelProvider.addModel', { ns: 'common' })}
              (
              {multipleModelConfigs.length}
              /4)
            </Button>
            <div className="mx-2 h-[14px] w-[1px] bg-divider-regular" />
          </>
        )}
        {mode !== AppModeEnum.COMPLETION && (
          <>
            {!readonly && (
              <TooltipPlus popupContent={t('operation.refresh', { ns: 'common' })}>
                <ActionButton onClick={onClearConversation}>
                  <RefreshCcw01 className="h-4 w-4" />
                </ActionButton>
              </TooltipPlus>
            )}
            {varListLength > 0 && (
              <div className="relative ml-1 mr-2">
                <TooltipPlus popupContent={t('panel.userInputField', { ns: 'workflow' })}>
                  <ActionButton
                    state={expanded ? ActionButtonState.Active : undefined}
                    onClick={() => !readonly && onExpandedChange(!expanded)}
                  >
                    <RiEqualizer2Line className="h-4 w-4" />
                  </ActionButton>
                </TooltipPlus>
                {expanded && (
                  <div className="absolute bottom-[-14px] right-[5px] z-10 h-3 w-3 rotate-45 border-l-[0.5px] border-t-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg" />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default DebugHeader
