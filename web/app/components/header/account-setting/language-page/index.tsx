'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useAppContext } from '@/context/app-context'
import { SimpleSelect } from '@/app/components/base/select'
import type { Item } from '@/app/components/base/select'
import { updateUserProfile } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'
import I18n from '@/context/i18n'
import { timezones } from '@/utils/timezone'
import { languages } from '@/i18n/language'

const titleClassName = `
  mb-2 text-sm font-medium text-gray-900
`

export default function LanguagePage() {
  const { locale, setLocaleOnClient } = useContext(I18n)
  const { userProfile, mutateUserProfile } = useAppContext()
  const { notify } = useContext(ToastContext)
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()

  const handleSelectLanguage = async (item: Item) => {
    const url = '/account/interface-language'
    const bodyKey = 'interface_language'

    setEditing(true)
    try {
      await updateUserProfile({ url, body: { [bodyKey]: item.value } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })

      setLocaleOnClient(item.value.toString())
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
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })

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
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.language.displayLanguage')}</div>
        <SimpleSelect
          defaultValue={locale || userProfile.interface_language}
          items={languages.filter(item => item.supported)}
          onSelect={item => handleSelectLanguage(item)}
          disabled={editing}
        />
      </div>
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.language.timezone')}</div>
        <SimpleSelect
          defaultValue={userProfile.timezone}
          items={timezones}
          onSelect={item => handleSelectTimezone(item)}
          disabled={editing}
        />
      </div>
    </>
  )
}
