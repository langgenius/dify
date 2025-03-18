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
    className?: string
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
    className: popupClassName,
    title: popupTitle,
  } = popupProps || {}

  const [localOpen, setLocalOpen] = useState(false)
  const mergedOpen = open ?? localOpen

  const handleOpenChange = useCallback((openValue: boolean) => {
    onOpenChange?.(openValue)
    setLocalOpen(openValue)
  }, [onOpenChange])

  const selectedOption = options.find(option => option.value === value)

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
            'group flex items-center px-2 h-8 bg-components-input-bg-normal hover:bg-state-base-hover-alt rounded-lg',
            mergedOpen && 'bg-state-base-hover-alt',
            triggerClassName,
          )}
        >
          {selectedOption?.label || t('common.placeholder.select')}
          <RiArrowDownSLine
            className={cn(
              'group-hover:text-text-secondary w-4 h-4 text-text-quaternary',
              mergedOpen && 'text-text-secondary',
            )}
          />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div
          className={cn(
            'p-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg',
            popupClassName,
          )}
        >
          {
            popupTitle && (
              <div className='flex items-center px-3 h-[22px] system-xs-medium-uppercase text-text-tertiary'>
                {popupTitle}
              </div>
            )
          }
          {
            options.map(option => (
              <div
                key={option.value}
                className='flex items-center px-2 h-8 hover:bg-state-base-hover rounded-lg cursor-pointer'
                title={option.label}
                onClick={() => onChange?.(option.value)}
              >
                <div className='grow truncate'>
                  {option.label}
                </div>
                {
                  value === option.value && <RiCheckLine className='shrink-0 w-4 h-4 text-text-accent' />
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
