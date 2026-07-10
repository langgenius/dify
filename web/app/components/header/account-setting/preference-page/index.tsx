'use client'
import type { Locale } from '@/i18n-config'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { refreshUserProfileAtom, userProfileAtom } from '@/context/account-state'
import { useLocale } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import { useRouter } from '@/next/navigation'
import { updateUserProfile } from '@/service/common'
import { timezones } from '@/utils/timezone'

type SelectOption = {
  value: string
  name: string
}

type TimezoneOption = {
  value: string
  name: string
}

const titleClassName = `
  mb-1 system-sm-medium text-text-secondary
`
const themes = ['system', 'light', 'dark'] as const
type ThemeOption = typeof themes[number]

const isThemeOption = (value: string): value is ThemeOption => {
  return (themes as readonly string[]).includes(value)
}

export default function PreferencePage() {
  const locale = useLocale()
  const userProfile = useAtomValue(userProfileAtom)
  const refreshUserProfile = useSetAtom(refreshUserProfileAtom)
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const languageOptions: SelectOption[] = languages.filter(item => item.supported)
  const themeOptions: SelectOption[] = [
    { value: 'system', name: t($ => $['account.appearanceFollowSystem'], { ns: 'common' }) },
    { value: 'light', name: t($ => $['account.appearanceLight'], { ns: 'common' }) },
    { value: 'dark', name: t($ => $['account.appearanceDark'], { ns: 'common' }) },
  ]
  const selectedLanguage = languageOptions.find(item => item.value === (locale || userProfile.interface_language))
  const selectedTheme = themeOptions.find(item => item.value === (theme || 'system'))
  const selectedTimezone = timezones.find(item => item.value === userProfile.timezone)
  const handleSelectTheme = (item: SelectOption) => {
    if (isThemeOption(item.value))
      setTheme(item.value)
  }
  const handleSelectLanguage = async (item: SelectOption) => {
    const url = '/account/interface-language'
    const bodyKey = 'interface_language'
    setEditing(true)
    try {
      await updateUserProfile({ url, body: { [bodyKey]: item.value } })
      toast.success(t($ => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      setLocaleOnClient(item.value.toString() as Locale, false)
      router.refresh()
    }
    catch (e) {
      toast.error((e as Error).message)
    }
    finally {
      setEditing(false)
    }
  }
  const handleSelectTimezone = async (item: TimezoneOption) => {
    const url = '/account/timezone'
    const bodyKey = 'timezone'
    setEditing(true)
    try {
      await updateUserProfile({ url, body: { [bodyKey]: item.value } })
      toast.success(t($ => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      refreshUserProfile()
    }
    catch (e) {
      toast.error((e as Error).message)
    }
    finally {
      setEditing(false)
    }
  }
  return (
    <>
      <div className="mb-6">
        <div className={titleClassName}>{t($ => $['account.appearanceLabel'], { ns: 'common' })}</div>
        <Select
          value={selectedTheme?.value ?? 'system'}
          onValueChange={(nextValue) => {
            if (!nextValue)
              return
            const nextItem = themeOptions.find(item => item.value === nextValue)
            if (nextItem)
              handleSelectTheme(nextItem)
          }}
        >
          <SelectTrigger size="medium">
            {selectedTheme?.name ?? t($ => $['account.appearanceFollowSystem'], { ns: 'common' })}
          </SelectTrigger>
          <SelectContent>
            {themeOptions.map(item => (
              <SelectItem key={item.value} value={item.value}>
                <SelectItemText>{item.name}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-6">
        <div className={titleClassName}>{t($ => $['language.displayLanguage'], { ns: 'common' })}</div>
        <Select
          value={selectedLanguage?.value ?? null}
          disabled={editing}
          onValueChange={(nextValue) => {
            if (nextValue == null)
              return
            const nextItem = languageOptions.find(item => item.value === nextValue)
            if (nextItem)
              handleSelectLanguage(nextItem)
          }}
        >
          <SelectTrigger size="medium">
            {selectedLanguage?.name ?? t($ => $['placeholder.select'], { ns: 'common' })}
          </SelectTrigger>
          <SelectContent>
            {languageOptions.map(item => (
              <SelectItem key={item.value} value={item.value}>
                <SelectItemText>{item.name}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-6">
        <div className={titleClassName}>{t($ => $['language.timezone'], { ns: 'common' })}</div>
        <Select
          value={selectedTimezone?.value ?? null}
          disabled={editing}
          onValueChange={(nextValue) => {
            if (!nextValue)
              return
            const nextItem = timezones.find(item => item.value === nextValue)
            if (nextItem)
              handleSelectTimezone(nextItem)
          }}
        >
          <SelectTrigger size="medium">
            {selectedTimezone?.name ?? t($ => $['placeholder.select'], { ns: 'common' })}
          </SelectTrigger>
          <SelectContent>
            {timezones.map(item => (
              <SelectItem key={item.value} value={item.value}>
                <SelectItemText>{item.name}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}
