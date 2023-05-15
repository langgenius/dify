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
import { languageMaps, languages } from '@/utils/language'

const titleClassName = `
  mb-2 text-sm font-medium text-gray-900
`

export default function LanguagePage() {
  const { locale, setLocaleOnClient } = useContext(I18n)
  const { userProfile, mutateUserProfile } = useAppContext()
  const { notify } = useContext(ToastContext)
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()
  const handleSelect = async (type: string, item: Item) => {
    let url = ''
    let bodyKey = ''
    if (type === 'language') {
      url = '/account/interface-language'
      bodyKey = 'interface_language'
      setLocaleOnClient(item.value === 'en-US' ? 'en' : 'zh-Hans')
    }
    if (type === 'timezone') {
      url = '/account/timezone'
      bodyKey = 'timezone'
    }
    try {
      setEditing(true)
      await updateUserProfile({ url, body: { [bodyKey]: item.value } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateUserProfile()
      setEditing(false)
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
      setEditing(false)
    }
  }

  return (
    <>
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.language.displayLanguage')}</div>
        <SimpleSelect
          defaultValue={languageMaps[locale] || userProfile.interface_language}
          items={languages}
          onSelect={item => handleSelect('language', item)}
          disabled={editing}
        />
      </div>
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.language.timezone')}</div>
        <SimpleSelect
          defaultValue={userProfile.timezone}
          items={timezones}
          onSelect={item => handleSelect('timezone', item)}
          disabled={editing}
        />
      </div>
    </>
  )
}
