import { Popover, Transition } from '@headlessui/react'
import { Fragment, cloneElement, useRef } from 'react'
import cn from '@/utils/classnames'

export type HtmlContentProps = {
  onClose?: () => void
  onClick?: () => void
}

type IPopover = {
  className?: string
  htmlContent: React.ReactElement<HtmlContentProps>
  popupClassName?: string
  trigger?: 'click' | 'hover'
  position?: 'bottom' | 'br' | 'bl'
  btnElement?: string | React.ReactNode
  btnClassName?: string | ((open: boolean) => string)
  manualClose?: boolean
  disabled?: boolean
}

const timeoutDuration = 100

export default function CustomPopover({
  trigger = 'hover',
  position = 'bottom',
  htmlContent,
  popupClassName,
  btnElement,
  className,
  btnClassName,
  manualClose,
  disabled = false,
}: IPopover) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const timeOutRef = useRef<NodeJS.Timeout | null>(null)

  const onMouseEnter = (isOpen: boolean) => {
    timeOutRef.current && clearTimeout(timeOutRef.current)
    !isOpen && buttonRef.current?.click()
  }

  const onMouseLeave = (isOpen: boolean) => {
    timeOutRef.current = setTimeout(() => {
      isOpen && buttonRef.current?.click()
    }, timeoutDuration)
  }

  return (
    <Popover className="relative">
      {({ open }: { open: boolean }) => {
        return (
          <>
            <div
              {...(trigger !== 'hover'
                ? {}
                : {
                  onMouseLeave: () => onMouseLeave(open),
                  onMouseEnter: () => onMouseEnter(open),
                })}
            >
              <Popover.Button
                ref={buttonRef}
                disabled={disabled}
                className={cn(
                  'group inline-flex items-center bg-components-button-secondary-bg px-3 py-2 rounded-lg text-base border border-components-button-secondary-border font-medium hover:bg-components-button-secondary-bg-hover hover:border-components-button-secondary-border-hover focus:outline-none',
                  open && 'bg-components-button-secondary-bg-hover border-components-button-secondary-border',
                  (btnClassName && typeof btnClassName === 'string') && btnClassName,
                  (btnClassName && typeof btnClassName !== 'string') && btnClassName?.(open),
                )}
              >
                {btnElement}
              </Popover.Button>
              <Transition as={Fragment}>
                <Popover.Panel
                  className={cn(
                    'absolute z-10 w-full max-w-sm px-4 mt-1 sm:px-0 lg:max-w-3xl',
                    position === 'bottom' && '-translate-x-1/2 left-1/2',
                    position === 'bl' && 'left-0',
                    position === 'br' && 'right-0',
                    className,
                  )}
                  {...(trigger !== 'hover'
                    ? {}
                    : {
                      onMouseLeave: () => onMouseLeave(open),
                      onMouseEnter: () => onMouseEnter(open),
                    })
                  }
                >
                  {({ close }) => (
                    <div
                      className={cn('overflow-hidden bg-components-panel-bg w-fit min-w-[130px] rounded-lg shadow-lg ring-1 ring-black ring-opacity-5', popupClassName)}
                      {...(trigger !== 'hover'
                        ? {}
                        : {
                          onMouseLeave: () => onMouseLeave(open),
                          onMouseEnter: () => onMouseEnter(open),
                        })
                      }
                    >
                      {cloneElement(htmlContent as React.ReactElement<HtmlContentProps>, {
                        onClose: () => onMouseLeave(open),
                        ...(manualClose
                          ? {
                            onClick: close,
                          }
                          : {}),
                      })}
                    </div>
                  )}
                </Popover.Panel>
              </Transition>
            </div>
          </>
        )
      }}
    </Popover>
  )
}
