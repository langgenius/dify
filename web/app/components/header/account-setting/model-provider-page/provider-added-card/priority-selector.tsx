import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { PreferredProviderTypeEnum } from '../declarations'

type SelectorProps = {
  value?: string
  onSelect: (key: PreferredProviderTypeEnum) => void
}
const Selector: FC<SelectorProps> = ({
  value,
  onSelect,
}) => {
  const { t } = useTranslation()
  const options = [
    {
      key: PreferredProviderTypeEnum.custom,
      text: t('modelProvider.apiKey', { ns: 'common' }),
    },
    {
      key: PreferredProviderTypeEnum.system,
      text: t('modelProvider.quota', { ns: 'common' }),
    },
  ]

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('modelProvider.card.priorityUse', { ns: 'common' })}
        render={(
          <Button
            className={cn(
              'h-6 w-6 rounded-md px-0 data-popup-open:bg-components-button-secondary-bg-hover',
            )}
          >
            <span className="i-ri-more-fill h-3 w-3" aria-hidden="true" />
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[144px] rounded-lg p-1"
      >
        <PopoverTitle className="px-3 pt-2 pb-1 text-sm font-medium text-text-secondary">
          {t('modelProvider.card.priorityUse', { ns: 'common' })}
        </PopoverTitle>
        {
          options.map(option => (
            <PopoverClose
              key={option.key}
              render={(
                <button
                  type="button"
                  className="flex h-9 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                  onClick={() => onSelect(option.key)}
                />
              )}
            >
              <span className="grow text-left">{option.text}</span>
              {value === option.key && <span className="i-ri-check-line h-4 w-4 text-text-accent" aria-hidden="true" />}
            </PopoverClose>
          ))
        }
      </PopoverContent>
    </Popover>
  )
}

export default Selector
