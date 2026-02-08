import type { BlockEnum } from '@/app/components/workflow/types'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { ErrorHandleTypeEnum } from './types'

type ErrorHandleTypeSelectorProps = {
  value: ErrorHandleTypeEnum
  onSelected: (value: ErrorHandleTypeEnum) => void
  nodeType?: BlockEnum
}
const ErrorHandleTypeSelector = ({
  value,
  onSelected,
  nodeType,
}: ErrorHandleTypeSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isLLMNode = nodeType === 'llm'
  const options = [
    {
      value: ErrorHandleTypeEnum.none,
      label: t('nodes.common.errorHandle.none.title', { ns: 'workflow' }),
      description: t('nodes.common.errorHandle.none.desc', { ns: 'workflow' }),
    },
    {
      value: ErrorHandleTypeEnum.defaultValue,
      label: t('nodes.common.errorHandle.defaultValue.title', { ns: 'workflow' }),
      description: t('nodes.common.errorHandle.defaultValue.desc', { ns: 'workflow' }),
    },
    {
      value: ErrorHandleTypeEnum.failBranch,
      label: t('nodes.common.errorHandle.failBranch.title', { ns: 'workflow' }),
      description: t('nodes.common.errorHandle.failBranch.desc', { ns: 'workflow' }),
    },
    ...(isLLMNode
      ? [{
          value: ErrorHandleTypeEnum.fallbackModel,
          label: t('nodes.common.errorHandle.fallbackModel.title', { ns: 'workflow' }),
          description: t('nodes.common.errorHandle.fallbackModel.desc', { ns: 'workflow' }),
        }]
      : []),
  ]
  const selectedOption = options.find(option => option.value === value)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={(e) => {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        setOpen(v => !v)
      }}
      >
        <Button
          size="small"
        >
          {selectedOption?.label}
          <RiArrowDownSLine className="h-3.5 w-3.5" />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
        <div className="w-[280px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          {
            options.map(option => (
              <div
                key={option.value}
                className="flex cursor-pointer rounded-lg p-2 pr-3 hover:bg-state-base-hover"
                onClick={(e) => {
                  e.stopPropagation()
                  e.nativeEvent.stopImmediatePropagation()
                  onSelected(option.value)
                  setOpen(false)
                }}
              >
                <div className="mr-1 w-4 shrink-0">
                  {
                    value === option.value && (
                      <RiCheckLine className="h-4 w-4 text-text-accent" />
                    )
                  }
                </div>
                <div className="grow">
                  <div className="system-sm-semibold mb-0.5 text-text-secondary">{option.label}</div>
                  <div className="system-xs-regular text-text-tertiary">{option.description}</div>
                </div>
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ErrorHandleTypeSelector
