'use client'
import { resources } from '@/i18n/i18next-config'
import { useEffect, useState } from 'react'
import cn from '@/utils/classnames'

export default function I18nTest() {
  const [langs, setLangs] = useState<Lang[]>([])

  useEffect(() => {
    setLangs(genLangs())
  }, [])

  return (
    <div
      style={{
        height: 'calc(100% - 6em)',
        overflowY: 'auto',
        margin: '1em 1em 5em',
      }}
    >

      <div style={{ minHeight: '75vh' }}>
        <h2>Summary</h2>

        <table
          className={cn('mt-2 min-w-[340px] border-collapse border-0')}
        >
          <thead className="system-xs-medium-uppercase text-text-tertiary">
            <tr>
              <td className="w-5 min-w-5 whitespace-nowrap rounded-l-lg bg-background-section-burn pl-2 pr-1">
                #
              </td>
              <td className="w-20 min-w-20 whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
                lang
              </td>
              <td className="w-20 min-w-20 whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
                count
              </td>
              <td className="w-20 min-w-20 whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
                missing
              </td>
              <td className="w-20 min-w-20 whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
                extra
              </td>
            </tr>
          </thead>
          <tbody className="system-sm-regular text-text-secondary">
            {langs.map(({ locale, count, missing, extra }, idx) => <tr key={locale}>
              <td className="">{idx}</td>
              <td className="p-1.5">{locale}</td>
              <td>{count}</td>
              <td>{missing.length}</td>
              <td>{extra.length}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <h2>Details</h2>

      <table
        className={cn('mt-2 w-full min-w-[340px] border-collapse border-0')}
      >
        <thead className="system-xs-medium-uppercase text-text-tertiary">
          <tr>
            <td className="w-5 min-w-5 whitespace-nowrap rounded-l-lg bg-background-section-burn pl-2 pr-1">
              #
            </td>
            <td className="w-20 min-w-20 whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
              lang
            </td>
            <td className="w-full whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
              missing
            </td>
            <td className="w-full whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
              extra
            </td>
          </tr>
        </thead>

        <tbody>
          {langs.map(({ locale, missing, extra }, idx) => {
            return (<tr key={locale}>
              <td className="py-2 align-top">{idx}</td>
              <td className="py-2 align-top">{locale}</td>
              <td className="py-2 align-top">
                <ul>
                  {missing.map(key => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
              </td>
              <td className="py-2 align-top">
                <ul>
                  {extra.map(key => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>

    </div>
  )
}

function genLangs() {
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
    if (key === 'en-US') en = lang
  }

  for (const lang of langs_) {
    const missing: string[] = []
    const extra: string[] = []

    for (const key of lang.keys)
      if (!en.keys.has(key)) extra.push(key)

    for (const key of en.keys)
      if (!lang.keys.has(key)) missing.push(key)

    lang.missing = missing
    lang.extra = extra
  }
  return langs_
}

function getNestedKeys(translation: Record<string, any>): string[] {
  const nestedKeys: string[] = []
  const iterateKeys = (obj: Record<string, any>, prefix = '') => {
    for (const key in obj) {
      const nestedKey = prefix ? `${prefix}.${key}` : key
      //   nestedKeys.push(nestedKey);
      if (typeof obj[key] === 'object') iterateKeys(obj[key], nestedKey)
      else if (typeof obj[key] === 'string') nestedKeys.push(nestedKey)
    }
  }
  iterateKeys(translation)
  return nestedKeys
}

type Lang = {
  locale: string;
  keys: Set<string>;
  count: number;
  missing: string[];
  extra: string[];
}
