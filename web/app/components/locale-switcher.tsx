'use client'

import { i18n } from '@/i18n'
import { setLocaleOnClient } from '@/i18n/client'

const LocaleSwitcher = () => {
  return (
    <div className="mt-4">
      <p>Locale switcher:</p>
      <ul>
        {i18n.locales.map((locale) => {
          return (
            <li key={locale}>
              <div className='cursor-pointer ' onClick={() => setLocaleOnClient(locale)}>{locale}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default LocaleSwitcher
