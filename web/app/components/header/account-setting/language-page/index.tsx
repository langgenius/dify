'use client'
import type { Locale } from '@/i18n-config'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
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
  value: string | number
  name: string
}

const titleClassName = `
  mb-2 system-sm-semibold text-text-secondary
`
export default function LanguagePage() {
  const locale = useLocale()
  const { userProfile, mutateUserProfile } = useAppContext()
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()
  const router = useRouter()
  const languageOptions: SelectOption[] = languages.filter(item => item.supported)
  const selectedLanguage = languageOptions.find(item => item.value === (locale || userProfile.interface_language))
  const selectedTimezone = timezones.find(item => item.value === userProfile.timezone)
  const handleSelectLanguage = async (item: SelectOption) => {
    const url = '/account/interface-language'
    const bodyKey = 'interface_language'
    setEditing(true)
    try {
      await updateUserProfile({ url, body: { [bodyKey]: item.value } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
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
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      mutateUserProfile()
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
      <div className="mb-8">
        <div className={titleClassName}>{t('language.displayLanguage', { ns: 'common' })}</div>
        <Select
          value={selectedLanguage?.value ?? null}
          disabled={editing}
          onValueChange={(nextValue) => {
            if (!nextValue)
              return
            const nextItem = languageOptions.find(item => item.value === nextValue)
            if (nextItem)
              handleSelectLanguage(nextItem)
          }}
        >
          <SelectTrigger size="large">
            {selectedLanguage?.name ?? t('placeholder.select', { ns: 'common' })}
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
      <div className="mb-8">
        <div className={titleClassName}>{t('language.timezone', { ns: 'common' })}</div>
        <Select
          value={selectedTimezone ? String(selectedTimezone.value) : null}
          disabled={editing}
          onValueChange={(nextValue) => {
            if (!nextValue)
              return
            const nextItem = timezones.find(item => String(item.value) === nextValue)
            if (nextItem)
              handleSelectTimezone(nextItem)
          }}
        >
          <SelectTrigger size="large">
            {selectedTimezone?.name ?? t('placeholder.select', { ns: 'common' })}
          </SelectTrigger>
          <SelectContent>
            {timezones.map(item => (
              <SelectItem key={item.value} value={String(item.value)}>
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
