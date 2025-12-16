import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react'
import { Fragment, cloneElement, isValidElement, useRef } from 'react'
import cn from '@/utils/classnames'

export type HtmlContentProps = {
  open?: boolean
  onClose?: () => void
  onClick?: () => void
}

type IPopover = {
  className?: string
  htmlContent: React.ReactNode
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
  const timeOutRef = useRef<number | null>(null)

  const onMouseEnter = (isOpen: boolean) => {
    if (timeOutRef.current != null)
      window.clearTimeout(timeOutRef.current)
    if (!isOpen)
      buttonRef.current?.click()
  }

  const onMouseLeave = (isOpen: boolean) => {
    timeOutRef.current = window.setTimeout(() => {
      if (isOpen)
        buttonRef.current?.click()
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
              <PopoverButton
                ref={buttonRef}
                disabled={disabled}
                className={cn(
                  'group inline-flex items-center rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 text-base font-medium hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus:outline-none',
                  open && 'border-components-button-secondary-border bg-components-button-secondary-bg-hover',
                  (btnClassName && typeof btnClassName === 'string') && btnClassName,
                  (btnClassName && typeof btnClassName !== 'string') && btnClassName?.(open),
                )}
              >
                {btnElement}
              </PopoverButton>
              <Transition as={Fragment}>
                <PopoverPanel
                  className={cn(
                    'absolute z-10 mt-1 w-full max-w-sm px-4 sm:px-0 lg:max-w-3xl',
                    position === 'bottom' && 'left-1/2 -translate-x-1/2',
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
                      className={cn('w-fit min-w-[130px] overflow-hidden rounded-lg bg-components-panel-bg shadow-lg ring-1 ring-black/5', popupClassName)}
                      {...(trigger !== 'hover'
                        ? {}
                        : {
                          onMouseLeave: () => onMouseLeave(open),
                          onMouseEnter: () => onMouseEnter(open),
                        })
                      }
                    >
                      {isValidElement(htmlContent)
                        ? cloneElement(htmlContent as React.ReactElement<HtmlContentProps>, {
                          open,
                          onClose: close,
                          ...(manualClose
                            ? {
                              onClick: close,
                            }
                            : {}),
                        })
                        : htmlContent}
                    </div>
                  )}
                </PopoverPanel>
              </Transition>
            </div>
          </>
        )
      }}
    </Popover>
  )
}
