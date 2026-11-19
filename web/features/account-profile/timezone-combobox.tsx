import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxInputTrigger,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  createComboboxItems,
  useComboboxFilter,
} from '@langgenius/dify-ui/combobox'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
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
  const { contains } = useComboboxFilter({ sensitivity: 'base' })

  return (
    <Field name="timezone">
      <FieldLabel>{label}</FieldLabel>
      <Combobox<TimezoneValue, false, TimezoneOption>
        items={timezoneItems}
        value={timezones.some((item) => item.value === value) ? value : null}
        readOnly={readOnly}
        filter={(item, query) => {
          const search = query.trim()
          return contains(item.name, search) || contains(item.value, search)
        }}
        onValueChange={(nextValue, details) => {
          if (nextValue === null) details.cancel()
          else if (nextValue !== value) onValueChange(nextValue)
        }}
      >
        <ComboboxInputGroup>
          <ComboboxInput
            placeholder={t(($) => $['account.timezoneSearchPlaceholder'], {
              ns: 'accountSettings',
            })}
            spellCheck={false}
          />
          <ComboboxInputTrigger aria-label={t(($) => $['placeholder.select'], { ns: 'common' })} />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
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
    </Field>
  )
}
