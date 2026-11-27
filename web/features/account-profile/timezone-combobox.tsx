import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  ComboboxValue,
  createComboboxItems,
  useComboboxFilter,
} from '@langgenius/dify-ui/combobox'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { timezones } from '@/utils/timezone'

type TimezoneOption = (typeof timezones)[number]
type TimezoneValue = TimezoneOption['value']

const timezoneItems = createComboboxItems(timezones, {
  getValue: (item) => item.value,
  getLabel: (item) => item.name,
})

type TimezoneComboboxProps = {
  label: string
  value: string | null | undefined
  onValueChange: (value: string) => void
  readOnly?: boolean
}

export function TimezoneCombobox({ label, value, onValueChange, readOnly }: TimezoneComboboxProps) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const timezoneLabelId = useId()
  const { contains } = useComboboxFilter({ sensitivity: 'base' })

  return (
    <div className="grid min-w-0 gap-1">
      <Combobox<TimezoneValue, false, TimezoneOption>
        items={timezoneItems}
        value={timezones.some((item) => item.value === value) ? value : null}
        readOnly={readOnly}
        filter={(item, query) => {
          const search = query.trim()
          return contains(item.name, search) || contains(item.value, search)
        }}
        onValueChange={(nextValue) => {
          if (nextValue !== null && nextValue !== value) onValueChange(nextValue)
        }}
      >
        <ComboboxLabel>
          <span id={timezoneLabelId}>{label}</span>
        </ComboboxLabel>
        <ComboboxTrigger
          className={cn(
            'group/select-trigger flex h-8 w-full items-center gap-0.5 rounded-lg border-0 bg-components-input-bg-normal py-2 ps-3 pe-2 text-start system-sm-regular text-components-input-text-filled',
            'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
            'data-placeholder:text-components-input-text-placeholder',
            'data-readonly:not-data-disabled:cursor-default data-readonly:not-data-disabled:bg-components-input-bg-normal data-readonly:not-data-disabled:hover:bg-components-input-bg-normal',
            'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled data-disabled:data-placeholder:text-components-input-text-disabled',
          )}
        >
          {/* oxlint-disable-next-line dify/require-title-for-truncated-text -- The picker exposes the full selected label in its options. */}
          <span className="min-w-0 grow truncate">
            <ComboboxValue<TimezoneValue>
              placeholder={t(($) => $['placeholder.select'], { ns: 'common' })}
            />
          </span>
          <ComboboxIcon className="text-text-quaternary group-[:hover:not([data-disabled],[data-readonly])]/select-trigger:text-text-secondary data-popup-open:text-text-secondary" />
        </ComboboxTrigger>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup aria-labelledby={timezoneLabelId}>
              <ComboboxInputGroup>
                <span
                  className="i-ri-search-line size-4 shrink-0 text-text-quaternary"
                  aria-hidden="true"
                />
                <ComboboxInput
                  spellCheck={false}
                  aria-label={t(($) => $['account.timezoneSearchPlaceholder'], {
                    ns: 'accountSettings',
                  })}
                  placeholder={t(($) => $['account.timezoneSearchPlaceholder'], {
                    ns: 'accountSettings',
                  })}
                />
              </ComboboxInputGroup>
              <ComboboxEmpty>
                {t(($) => $['account.timezoneNoResults'], { ns: 'accountSettings' })}
              </ComboboxEmpty>
              <ComboboxList<TimezoneOption>>
                {(item) => (
                  <ComboboxItem<TimezoneValue> key={item.value} value={item.value}>
                    <ComboboxItemText className="wrap-anywhere text-clip whitespace-normal">
                      {item.name}
                    </ComboboxItemText>
                    <ComboboxItemIndicator />
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  )
}
