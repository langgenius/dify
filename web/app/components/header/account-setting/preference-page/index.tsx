'use client'
import type { Locale } from '@/i18n'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { setLocaleOnClient } from '@/i18n/client'
import { languages } from '@/i18n/language'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { timezones } from '@/utils/timezone'

type TimezoneOption = (typeof timezones)[number]
type TimezoneValue = TimezoneOption['value']
type ThemeValue = 'system' | 'light' | 'dark'

const languageItems = languages
  .filter((item) => item.supported)
  .map((item) => ({ value: item.value, label: item.name }))

const profileMutationOptions = consoleQuery.account.profile.patch.mutationOptions()

const timezoneItems = createComboboxItems(timezones, {
  getValue: (item) => item.value,
  getLabel: (item) => item.name,
})

export default function PreferencePage() {
  const locale = useLocale()
  const timezoneLabelId = useId()
  const { contains } = useComboboxFilter({ sensitivity: 'base' })
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const { t } = useTranslation(['common', 'accountSettings'])
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const updateProfile = useMutation(
    consoleQuery.account.profile.patch.mutationOptions({
      onSuccess: async (data, variables, onMutateResult, context) => {
        const language = variables.body.interface_language
        await Promise.all([
          profileMutationOptions.onSuccess?.(data, variables, onMutateResult, context),
          language
            ? setLocaleOnClient(language, false).then(
                () => router.refresh(),
                (error: unknown) => {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t(($) => $['api.actionFailed'], { ns: 'common' }),
                  )
                },
              )
            : undefined,
        ])
      },
    }),
  )
  const themeItems = [
    {
      value: 'system',
      label: t(($) => $['account.appearanceFollowSystem'], { ns: 'accountSettings' }),
    },
    { value: 'light', label: t(($) => $['account.appearanceLight'], { ns: 'accountSettings' }) },
    { value: 'dark', label: t(($) => $['account.appearanceDark'], { ns: 'accountSettings' }) },
  ] satisfies { value: ThemeValue; label: string }[]
  const selectedLanguage = languageItems.find(
    (item) => item.value === (locale || userProfile.interface_language),
  )
  const selectedTheme = themeItems.find((item) => item.value === theme)?.value ?? 'system'
  const selectedTimezone = timezones.find((item) => item.value === userProfile.timezone)
  return (
    <div className="grid gap-6 pt-1 pb-4">
      <div className="grid min-w-0 gap-1">
        <Select<ThemeValue>
          items={themeItems}
          value={selectedTheme}
          onValueChange={(nextValue) => {
            if (nextValue === null || nextValue === selectedTheme) return
            setTheme(nextValue)
          }}
        >
          <SelectLabel>
            {t(($) => $['account.appearanceLabel'], { ns: 'accountSettings' })}
          </SelectLabel>
          <SelectTrigger size="medium">
            <SelectValue<ThemeValue> />
          </SelectTrigger>
          <SelectContent>
            {themeItems.map((item) => (
              <SelectItem<ThemeValue> key={item.value} value={item.value}>
                <SelectItemText>{item.label}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-w-0 gap-1">
        <Select<Locale>
          items={languageItems}
          value={selectedLanguage?.value ?? null}
          readOnly={updateProfile.isPending}
          onValueChange={(nextValue) => {
            if (nextValue === null || nextValue === selectedLanguage?.value) return
            updateProfile.mutate({ body: { interface_language: nextValue } })
          }}
        >
          <SelectLabel>{t(($) => $['language.displayLanguage'], { ns: 'common' })}</SelectLabel>
          <SelectTrigger size="medium">
            <SelectValue<Locale>
              placeholder={t(($) => $['placeholder.select'], { ns: 'common' })}
            />
          </SelectTrigger>
          <SelectContent>
            {languageItems.map((item) => (
              <SelectItem<Locale> key={item.value} value={item.value}>
                <SelectItemText>{item.label}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-w-0 gap-1">
        <Combobox<TimezoneValue, false, TimezoneOption>
          items={timezoneItems}
          value={selectedTimezone?.value ?? null}
          readOnly={updateProfile.isPending}
          filter={(item, query) => {
            const search = query.trim()
            return contains(item.name, search) || contains(item.value, search)
          }}
          onValueChange={(nextValue) => {
            if (nextValue === null || nextValue === userProfile.timezone) return
            updateProfile.mutate({ body: { timezone: nextValue } })
          }}
        >
          <ComboboxLabel>
            <span id={timezoneLabelId}>{t(($) => $['language.timezone'], { ns: 'common' })}</span>
          </ComboboxLabel>
          <ComboboxTrigger className="group/timezone-trigger flex min-h-8 w-full min-w-0 items-center gap-0.5 rounded-lg border-0 bg-components-input-bg-normal py-2 pr-2 pl-3 text-start system-sm-regular text-components-input-text-filled hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled data-placeholder:text-components-input-text-placeholder data-disabled:data-placeholder:text-components-input-text-disabled data-popup-open:bg-state-base-hover-alt">
            <span className="min-w-0 grow wrap-anywhere whitespace-normal">
              <ComboboxValue<TimezoneValue>
                placeholder={t(($) => $['placeholder.select'], { ns: 'common' })}
              />
            </span>
            <ComboboxIcon className="text-text-quaternary transition-colors group-data-popup-open/timezone-trigger:text-text-secondary group-[:hover:not([data-disabled])]/timezone-trigger:text-text-secondary" />
          </ComboboxTrigger>
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup
                aria-labelledby={timezoneLabelId}
                className="max-w-(--available-width)"
              >
                <ComboboxInputGroup>
                  <span
                    className="i-ri-search-line size-4 shrink-0 text-text-quaternary"
                    aria-hidden="true"
                  />
                  <ComboboxInput
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
    </div>
  )
}
