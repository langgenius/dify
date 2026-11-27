'use client'
import type { ThemePreference } from '@/features/theme/theme'
import type { Locale } from '@/i18n'
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
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { TimezoneCombobox } from '@/features/account-profile/timezone-combobox'
import { useThemePreference } from '@/features/theme/hooks'
import { themeOptions } from '@/features/theme/theme'
import { setLocaleOnClient } from '@/i18n/client'
import { languages } from '@/i18n/language'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

const languageItems = languages
  .filter((item) => item.supported)
  .map((item) => ({ value: item.value, label: item.name }))

export default function PreferencePage() {
  const locale = useLocale()
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const { t } = useTranslation(['common', 'accountSettings'])
  const router = useRouter()
  const { preference, setPreference } = useThemePreference()
  const updateProfile = useMutation(
    consoleQuery.account.profile.patch.mutationOptions({
      onSuccess: async (_data, variables) => {
        const language = variables.body.interface_language
        if (!language) return
        await setLocaleOnClient(language).then(
          () => router.refresh(),
          (error: unknown) => {
            toast.error(
              error instanceof Error
                ? error.message
                : t(($) => $['api.actionFailed'], { ns: 'common' }),
            )
          },
        )
      },
    }),
  )
  const themeItems = themeOptions.map((option) => ({
    value: option.value,
    label: t(($) => $[option.labelKey], { ns: 'common' }),
  }))
  const selectedLanguage = languageItems.find(
    (item) => item.value === (locale || userProfile.interface_language),
  )
  return (
    <div className="grid gap-6 pt-1 pb-4">
      <div className="grid min-w-0 gap-1">
        <Select<ThemePreference>
          items={themeItems}
          value={preference}
          onValueChange={(nextValue) => {
            if (nextValue === null || nextValue === preference) return
            setPreference(nextValue)
          }}
        >
          <SelectLabel>{t(($) => $['theme.label'], { ns: 'common' })}</SelectLabel>
          <SelectTrigger size="medium">
            <SelectValue<ThemePreference> />
          </SelectTrigger>
          <SelectContent>
            {themeItems.map((item) => (
              <SelectItem<ThemePreference> key={item.value} value={item.value}>
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
      <TimezoneCombobox
        label={t(($) => $['language.timezone'], { ns: 'common' })}
        value={userProfile.timezone}
        readOnly={updateProfile.isPending}
        onValueChange={(timezone) => updateProfile.mutate({ body: { timezone } })}
      />
    </div>
  )
}
