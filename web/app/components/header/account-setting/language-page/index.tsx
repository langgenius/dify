'use client'
import type { Item } from '@/app/components/base/select'
import type { Locale } from '@/i18n-config'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleSelect } from '@/app/components/base/select'
import { toast } from '@/app/components/base/ui/toast'
import { useAppContext } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import { useRouter } from '@/next/navigation'
import { updateUserProfile } from '@/service/common'
import { timezones } from '@/utils/timezone'

const titleClassName = `
  mb-2 system-sm-semibold text-text-secondary
`
export default function LanguagePage() {
  const locale = useLocale()
  const { userProfile, mutateUserProfile } = useAppContext()
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()
  const router = useRouter()
  const handleSelectLanguage = async (item: Item) => {
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
  const handleSelectTimezone = async (item: Item) => {
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
        <SimpleSelect defaultValue={locale || userProfile.interface_language} items={languages.filter(item => item.supported)} onSelect={item => handleSelectLanguage(item)} disabled={editing} notClearable={true} />
      </div>
      <div className="mb-8">
        <div className={titleClassName}>{t('language.timezone', { ns: 'common' })}</div>
        <SimpleSelect defaultValue={userProfile.timezone} items={timezones} onSelect={item => handleSelectTimezone(item)} disabled={editing} notClearable={true} />
      </div>
    </>
  )
}
