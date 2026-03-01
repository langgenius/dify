'use client'

import type { Item } from '@/app/components/base/select'
import type { Locale } from '@/i18n-config'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { SimpleSelect } from '@/app/components/base/select'
import { ToastContext } from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import { updateUserProfile } from '@/service/common'
import { timezones } from '@/utils/timezone'

const titleClassName = `
  mb-2 system-sm-semibold text-text-secondary
`

export default function LanguagePage() {
  const locale = useLocale()
  const { userProfile, mutateUserProfile } = useAppContext()
  const { notify } = useContext(ToastContext)
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()
  const router = useRouter()

  const handleSelectLanguage = async (item: Item) => {
    const url = '/account/interface-language'
    const bodyKey = 'interface_language'

    setEditing(true)
    try {
      await updateUserProfile({ url, body: { [bodyKey]: item.value } })
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })

      setLocaleOnClient(item.value.toString() as Locale, false)
      router.refresh()
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
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
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })

      mutateUserProfile()
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
    }
    finally {
      setEditing(false)
    }
  }

  return (
    <>
      <div className="mb-8">
        <div className={titleClassName}>{t('language.displayLanguage', { ns: 'common' })}</div>
        <SimpleSelect
          defaultValue={locale || userProfile.interface_language}
          items={languages.filter(item => item.supported)}
          onSelect={item => handleSelectLanguage(item)}
          disabled={editing}
          notClearable={true}
        />
      </div>
      <div className="mb-8">
        <div className={titleClassName}>{t('language.timezone', { ns: 'common' })}</div>
        <SimpleSelect
          defaultValue={userProfile.timezone}
          items={timezones}
          onSelect={item => handleSelectTimezone(item)}
          disabled={editing}
          notClearable={true}
        />
      </div>
    </>
  )
}
