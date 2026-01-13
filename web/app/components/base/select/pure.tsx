import type {
  PortalToFollowElemOptions,
} from '@/app/components/base/portal-to-follow-elem'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

export type Option = {
  label: string
  value: string
}

type SharedPureSelectProps = {
  options: Option[]
  containerProps?: PortalToFollowElemOptions & {
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }
  triggerProps?: {
    className?: string
  }
  popupProps?: {
    wrapperClassName?: string
    className?: string
    itemClassName?: string
    title?: string
    titleClassName?: string
  }
  placeholder?: string
  disabled?: boolean
  triggerPopupSameWidth?: boolean
}

type SingleSelectProps = {
  multiple?: false
  value?: string
  onChange?: (value: string) => void
}

type MultiSelectProps = {
  multiple: true
  value?: string[]
  onChange?: (value: string[]) => void
}

export type PureSelectProps = SharedPureSelectProps & (SingleSelectProps | MultiSelectProps)
const PureSelect = (props: PureSelectProps) => {
  const {
    options,
    containerProps,
    triggerProps,
    popupProps,
    placeholder,
    disabled,
    triggerPopupSameWidth,
    multiple,
    value,
    onChange,
  } = props
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
    titleClassName: popupTitleClassName,
  } = popupProps || {}

  const [localOpen, setLocalOpen] = useState(false)
  const mergedOpen = open ?? localOpen

  const handleOpenChange = useCallback((openValue: boolean) => {
    onOpenChange?.(openValue)
    setLocalOpen(openValue)
  }, [onOpenChange])

  const triggerText = useMemo(() => {
    const placeholderText = placeholder || t('placeholder.select', { ns: 'common' })
    if (multiple)
      return value?.length ? t('dynamicSelect.selected', { ns: 'common', count: value.length }) : placeholderText

    return options.find(option => option.value === value)?.label || placeholderText
  }, [multiple, value, options, placeholder])

  return (
    <PortalToFollowElem
      placement={placement || 'bottom-start'}
      offset={offset || 4}
      open={mergedOpen}
      onOpenChange={handleOpenChange}
      triggerPopupSameWidth={triggerPopupSameWidth}
    >
      <PortalToFollowElemTrigger
        onClick={() => !disabled && handleOpenChange(!mergedOpen)}
        asChild
      >
        <div
          className={cn(
            'system-sm-regular group flex h-8 items-center rounded-lg bg-components-input-bg-normal px-2 text-components-input-text-filled',
            !disabled && 'cursor-pointer hover:bg-state-base-hover-alt',
            disabled && 'cursor-not-allowed opacity-50',
            mergedOpen && !disabled && 'bg-state-base-hover-alt',
            triggerClassName,
          )}
        >
          <div
            className="grow"
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
        'z-[9999]',
        popupWrapperClassName,
      )}
      >
        <div
          className={cn(
            'max-h-80 overflow-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg',
            popupClassName,
          )}
        >
          {
            popupTitle && (
              <div className={cn(
                'system-xs-medium-uppercase flex h-[22px] items-center px-3 text-text-tertiary',
                popupTitleClassName,
              )}
              >
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
                  if (disabled)
                    return
                  if (multiple) {
                    const currentValues = value ?? []
                    const nextValues = currentValues.includes(option.value)
                      ? currentValues.filter(valueItem => valueItem !== option.value)
                      : [...currentValues, option.value]
                    onChange?.(nextValues)
                    return
                  }
                  onChange?.(option.value)
                  handleOpenChange(false)
                }}
              >
                <div className="mr-1 grow truncate px-1">
                  {option.label}
                </div>
                {
                  (
                    multiple
                      ? (value ?? []).includes(option.value)
                      : value === option.value
                  ) && <RiCheckLine className="h-4 w-4 shrink-0 text-text-accent" />
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
