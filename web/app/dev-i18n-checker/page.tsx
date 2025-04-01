'use client'

import { useI18N } from '@/context/i18n'
import { resources } from '@/i18n/i18next-config'
import { useEffect, useState } from 'react'

function getNestedKeys(translation: Record<string, any>): string[] {
  const nestedKeys: string[] = []
  const iterateKeys = (obj: Record<string, any>, prefix = '') => {
    for (const key in obj) {
      const nestedKey = prefix ? `${prefix}.${key}` : key
      //   nestedKeys.push(nestedKey);
      if (typeof obj[key] === 'object')
        iterateKeys(obj[key], nestedKey)
      else if (typeof obj[key] === 'string')
        nestedKeys.push(nestedKey)
    }
  }
  iterateKeys(translation)
  return nestedKeys
}

export default function I18nTest() {
  type Lang = {
    locale: string;
    keys: Set<string>;
    count: number;
    missing: string[];
    extra: string[];
  }

  const { locale } = useI18N()
  const [langs, setLangs] = useState<Lang[]>([])

  useEffect(() => {
    const langs_: Lang[] = []
    let en!: Lang

    for (const [key, value] of Object.entries(resources)) {
      const keys = getNestedKeys(value.translation)
      const lang: Lang = {
        locale: key,
        keys: new Set(keys),
        count: keys.length,
        missing: [],
        extra: [],
      }

      langs_.push(lang)
      if (key === 'en-US')
        en = lang
    }

    for (const lang of langs_) {
      const missing: string[] = []
      const extra: string[] = []

      for (const key of lang.keys) {
        if (!en.keys.has(key))
          extra.push(key)
      }

      for (const key of en.keys) {
        if (!lang.keys.has(key))
          missing.push(key)
      }

      lang.missing = missing
      lang.extra = extra
    }

    setLangs(langs_)
  }, [])

  return (
    <div
      style={{
        height: 'calc(100% - 6em)',
        overflowY: 'auto',
        margin: '1em 1em 5em',
      }}
    >
      <h2>summary</h2>
      <ul>
        {langs.map(({ locale, missing, extra, count }) => {
          return (
            <li key={locale}>
              {locale}, count {count}, missing {missing.length}, extra{' '}
              {extra.length}
            </li>
          )
        })}
      </ul>

      <h2>details</h2>
      <dl>
        {langs.map(({ locale, missing, extra }) => {
          return (
            <>
              <dt>
                {locale}, missing {missing.length}, extra {extra.length}
              </dt>
              <dd style={{ marginLeft: '1em' }}>
                <div>missing</div>
                <ul>
                  {missing.map(key => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
                <div>extra</div>
                <ul>
                  {extra.map(key => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
              </dd>
            </>
          )
        })}
      </dl>
    </div>
  )
}
