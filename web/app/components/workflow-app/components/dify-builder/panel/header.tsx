import type { RefObject } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { PopoverDescription, PopoverTitle } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import DebugLogExport from '../debug-log-export'
import { useDifyBuilderInteractionLocale } from '../interactions/use-interaction-locale'

type DifyBuilderPanelHeaderProps = {
  resetDisabled: boolean
  titleRef: RefObject<HTMLHeadingElement | null>
  onReset: () => void
  onClose: () => void
}

export const DifyBuilderPanelHeader = ({
  resetDisabled,
  titleRef,
  onReset,
  onClose,
}: DifyBuilderPanelHeaderProps) => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })

  return (
    <header className="relative z-10 flex h-11 shrink-0 items-center gap-2 bg-linear-to-b from-background-neutral-subtle to-transparent pr-3 pl-4.5">
      <h2
        ref={titleRef}
        tabIndex={-1}
        className="relative min-w-0 grow rounded-sm py-2 system-sm-semibold-uppercase text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        {t(($) => $.panelTitle, { ns: 'difyBuilder' })}
      </h2>
      <div className="relative flex shrink-0 items-center gap-2">
        <DebugLogExport />
        <Infotip>
          <InfotipTrigger
            aria-label={t(($) => $.helpTitle, { ns: 'difyBuilder' })}
            iconSize="large"
            className="size-7 rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary data-popup-open:bg-state-accent-active data-popup-open:text-text-accent"
          />
          <InfotipContent placement="bottom-end" sideOffset={8} className="w-58">
            <PopoverTitle className="system-xs-semibold text-text-primary">
              {t(($) => $.helpTitle, { ns: 'difyBuilder' })}
            </PopoverTitle>
            <PopoverDescription className="system-xs-regular text-text-secondary">
              {t(($) => $.helpDescription, { ns: 'difyBuilder' })}
            </PopoverDescription>
          </InfotipContent>
        </Infotip>
        <IconButton
          size="md"
          disabled={resetDisabled}
          aria-label={t(($) => $.reset, { ns: 'difyBuilder' })}
          className="size-7"
          onClick={onReset}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </IconButton>
        <span aria-hidden className="h-3.5 w-px bg-divider-regular" />
        <IconButton
          size="md"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          className="size-7"
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line size-4" />
        </IconButton>
      </div>
    </header>
  )
}
