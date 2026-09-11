import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverDescription, PopoverTitle } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import DebugLogExport from '../debug-log-export'

type DifyBuilderPanelHeaderProps = {
  resetDisabled: boolean
  onReset: () => void
  onClose: () => void
}

export const DifyBuilderPanelHeader = ({
  resetDisabled,
  onReset,
  onClose,
}: DifyBuilderPanelHeaderProps) => {
  const { t } = useTranslation()

  return (
    <header className="relative z-10 flex h-11 shrink-0 items-center gap-2 bg-linear-to-b from-background-section to-transparent pr-3 pl-4.5">
      <h2 className="relative min-w-0 grow py-2 system-sm-semibold-uppercase text-text-primary">
        {t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
      </h2>
      <div className="relative flex shrink-0 items-center gap-2">
        <DebugLogExport />
        <Infotip
          aria-label={t(($) => $['difyBuilder.helpTitle'], { ns: 'workflow' })}
          iconSize="large"
          placement="bottom-end"
          sideOffset={8}
          className="size-7 rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary data-popup-open:bg-state-accent-active data-popup-open:text-text-accent"
          popupClassName="flex w-58 flex-col gap-1 rounded-xl bg-components-tooltip-bg px-4 py-3.5 backdrop-blur-[5px]"
        >
          <PopoverTitle className="system-xs-semibold text-text-primary">
            {t(($) => $['difyBuilder.helpTitle'], { ns: 'workflow' })}
          </PopoverTitle>
          <PopoverDescription className="system-xs-regular text-text-secondary">
            {t(($) => $['difyBuilder.helpDescription'], { ns: 'workflow' })}
          </PopoverDescription>
        </Infotip>
        <IconButton
          size="md"
          disabled={resetDisabled}
          aria-label={t(($) => $['difyBuilder.reset'], { ns: 'workflow' })}
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
