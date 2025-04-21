import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { ErrorHandleTypeEnum } from './types'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'

type ErrorHandleTypeSelectorProps = {
  value: ErrorHandleTypeEnum
  onSelected: (value: ErrorHandleTypeEnum) => void
}
const ErrorHandleTypeSelector = ({
  value,
  onSelected,
}: ErrorHandleTypeSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const options = [
    {
      value: ErrorHandleTypeEnum.none,
      label: t('workflow.nodes.common.errorHandle.none.title'),
      description: t('workflow.nodes.common.errorHandle.none.desc'),
    },
    {
      value: ErrorHandleTypeEnum.defaultValue,
      label: t('workflow.nodes.common.errorHandle.defaultValue.title'),
      description: t('workflow.nodes.common.errorHandle.defaultValue.desc'),
    },
    {
      value: ErrorHandleTypeEnum.failBranch,
      label: t('workflow.nodes.common.errorHandle.failBranch.title'),
      description: t('workflow.nodes.common.errorHandle.failBranch.desc'),
    },
  ]
  const selectedOption = options.find(option => option.value === value)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={(e) => {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        setOpen(v => !v)
      }}>
        <Button
          size='small'
        >
          {selectedOption?.label}
          <RiArrowDownSLine className='h-3.5 w-3.5' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[280px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          {
            options.map(option => (
              <div
                key={option.value}
                className='flex cursor-pointer rounded-lg p-2 pr-3 hover:bg-state-base-hover'
                onClick={(e) => {
                  e.stopPropagation()
                  e.nativeEvent.stopImmediatePropagation()
                  onSelected(option.value)
                  setOpen(false)
                }}
              >
                <div className='mr-1 w-4 shrink-0'>
                  {
                    value === option.value && (
                      <RiCheckLine className='h-4 w-4 text-text-accent' />
                    )
                  }
                </div>
                <div className='grow'>
                  <div className='system-sm-semibold mb-0.5 text-text-secondary'>{option.label}</div>
                  <div className='system-xs-regular text-text-tertiary'>{option.description}</div>
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
