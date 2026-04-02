'use client'

import { useTranslation } from '#i18n'
import { RiArrowDownSLine, RiCloseCircleFill, RiGlobalLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import { LANGUAGE_OPTIONS } from '../search-page/constants'

type HeroLanguagesFilterProps = {
  languages: string[]
  onLanguagesChange: (languages: string[]) => void
}

const LANGUAGE_LABEL_MAP: Record<string, string> = LANGUAGE_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.nativeLabel
  return acc
}, {} as Record<string, string>)

const HeroLanguagesFilter = ({
  languages,
  onLanguagesChange,
}: HeroLanguagesFilterProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const selectedLanguagesLength = languages.length
  const hasSelected = selectedLanguagesLength > 0

  const filteredOptions = useMemo(() => {
    if (!searchText)
      return LANGUAGE_OPTIONS
    const normalizedSearchText = searchText.toLowerCase()
    return LANGUAGE_OPTIONS.filter(option =>
      option.nativeLabel.toLowerCase().includes(normalizedSearchText)
      || option.label.toLowerCase().includes(normalizedSearchText),
    )
  }, [searchText])

  const handleCheck = (value: string) => {
    if (languages.includes(value))
      onLanguagesChange(languages.filter(language => language !== value))
    else
      onLanguagesChange([...languages, value])
  }

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={{
        mainAxis: 4,
        crossAxis: -6,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger
        className="shrink-0"
        onClick={() => setOpen(v => !v)}
      >
        <div
          className={cn(
            'flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-1.5',
            !hasSelected && 'border border-white/30 text-text-primary-on-surface',
            !hasSelected && open && 'bg-state-base-hover',
            !hasSelected && !open && 'hover:bg-state-base-hover',
            hasSelected && 'border-effect-highlight border bg-components-button-secondary-bg-hover shadow-md backdrop-blur-[5px]',
          )}
        >
          <RiGlobalLine
            className={cn(
              'size-4 shrink-0',
              hasSelected ? 'text-saas-dify-blue-inverted' : 'text-text-primary-on-surface',
            )}
          />
          <div className="system-md-medium flex items-center gap-0.5">
            {!hasSelected && (
              <span>{t('marketplace.languages', { ns: 'plugin' })}</span>
            )}
            {hasSelected && (
              <span className="text-saas-dify-blue-inverted">
                {languages
                  .map(language => LANGUAGE_LABEL_MAP[language])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(', ')}
              </span>
            )}
            {selectedLanguagesLength > 2 && (
              <div className="flex min-w-4 items-center justify-center rounded-[5px] border border-saas-dify-blue-inverted px-1 py-0.5">
                <span className="system-2xs-medium-uppercase text-saas-dify-blue-inverted">
                  +
                  {selectedLanguagesLength - 2}
                </span>
              </div>
            )}
          </div>
          {hasSelected && (
            <RiCloseCircleFill
              className="size-4 shrink-0 text-saas-dify-blue-inverted"
              onClick={(e) => {
                e.stopPropagation()
                onLanguagesChange([])
              }}
            />
          )}
          {!hasSelected && (
            <RiArrowDownSLine className="size-4 shrink-0 text-text-primary-on-surface" />
          )}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
          <div className="p-2 pb-1">
            <Input
              showLeftIcon
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('marketplace.searchFilterLanguage', { ns: 'plugin' })}
            />
          </div>
          <div className="max-h-[448px] overflow-y-auto p-1">
            {filteredOptions.map(option => (
              <div
                key={option.value}
                className="flex h-7 cursor-pointer select-none items-center rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
                onClick={() => handleCheck(option.value)}
              >
                <Checkbox
                  className="mr-1"
                  checked={languages.includes(option.value)}
                />
                <div className="system-sm-medium px-1 text-text-secondary">
                  {option.nativeLabel}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(HeroLanguagesFilter)
