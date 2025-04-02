import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type {
  PortalToFollowElemOptions,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'

type Option = {
  label: string
  value: string
}

type PureSelectProps = {
  options: Option[]
  value?: string
  onChange?: (value: string) => void
  containerProps?: PortalToFollowElemOptions & {
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }
  triggerProps?: {
    className?: string
  },
  popupProps?: {
    wrapperClassName?: string
    className?: string
    itemClassName?: string
    title?: string
  },
}
const PureSelect = ({
  options,
  value,
  onChange,
  containerProps,
  triggerProps,
  popupProps,
}: PureSelectProps) => {
  const { t } = useTranslation()
  const {
    open,
    onOpenChange,
    placement,
    offset,
  } = containerProps || {}
  const {
    className: triggerClassName,
  } = triggerProps || {}
  const {
    wrapperClassName: popupWrapperClassName,
    className: popupClassName,
    itemClassName: popupItemClassName,
    title: popupTitle,
  } = popupProps || {}

  const [localOpen, setLocalOpen] = useState(false)
  const mergedOpen = open ?? localOpen

  const handleOpenChange = useCallback((openValue: boolean) => {
    onOpenChange?.(openValue)
    setLocalOpen(openValue)
  }, [onOpenChange])

  const selectedOption = options.find(option => option.value === value)
  const triggerText = selectedOption?.label || t('common.placeholder.select')

  return (
    <PortalToFollowElem
      placement={placement || 'bottom-start'}
      offset={offset || 4}
      open={mergedOpen}
      onOpenChange={handleOpenChange}
    >
      <PortalToFollowElemTrigger
        onClick={() => handleOpenChange(!mergedOpen)}
        asChild
      >
        <div
          className={cn(
            'system-sm-regular group flex h-8 cursor-pointer items-center rounded-lg bg-components-input-bg-normal px-2 text-components-input-text-filled hover:bg-state-base-hover-alt',
            mergedOpen && 'bg-state-base-hover-alt',
            triggerClassName,
          )}
        >
          <div
            className='grow'
            title={triggerText}
          >
            {triggerText}
          </div>
          <RiArrowDownSLine
            className={cn(
              'h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary',
              mergedOpen && 'text-text-secondary',
            )}
          />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={cn(
        'z-10',
        popupWrapperClassName,
      )}>
        <div
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg',
            popupClassName,
          )}
        >
          {
            popupTitle && (
              <div className='system-xs-medium-uppercase flex h-[22px] items-center px-3 text-text-tertiary'>
                {popupTitle}
              </div>
            )
          }
          {
            options.map(option => (
              <div
                key={option.value}
                className={cn(
                  'system-sm-medium flex h-8 cursor-pointer items-center rounded-lg px-2 text-text-secondary hover:bg-state-base-hover',
                  popupItemClassName,
                )}
                title={option.label}
                onClick={() => {
                  onChange?.(option.value)
                  handleOpenChange(false)
                }}
              >
                <div className='mr-1 grow truncate px-1'>
                  {option.label}
                </div>
                {
                  value === option.value && <RiCheckLine className='h-4 w-4 shrink-0 text-text-accent' />
                }
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default PureSelect
