import {
  Combobox,
  ComboboxEmpty,
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
  ComboboxValue,
  createComboboxItems,
  useComboboxFilter,
} from '@langgenius/dify-ui/combobox'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { timezones } from '@/utils/timezone'
import { PreferenceComboboxTrigger } from './preference-combobox-trigger'

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
        <PreferenceComboboxTrigger>
          <ComboboxValue<TimezoneValue>
            placeholder={t(($) => $['placeholder.select'], { ns: 'common' })}
          />
        </PreferenceComboboxTrigger>
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
