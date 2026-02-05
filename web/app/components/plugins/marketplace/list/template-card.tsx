'use client'

import type { Template } from '../types'
import { useLocale } from '#i18n'
import Image from 'next/image'
import * as React from 'react'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'

type TemplateCardProps = {
  template: Template
  className?: string
}

const TemplateCardComponent = ({
  template,
  className,
}: TemplateCardProps) => {
  const locale = useLocale()
  const { name, description, icon, tags, author } = template

  const descriptionText = description[getLanguage(locale)] || description.en_US || ''

  return (
    <div className={cn(
      'hover-bg-components-panel-on-panel-item-bg relative cursor-pointer overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs',
      className,
    )}
    >
      {/* Header */}
      <div className="flex">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background-default-lighter">
          {icon
            ? (
                <Image
                  src={icon}
                  alt={name}
                  width={24}
                  height={24}
                  className="h-6 w-6 object-contain"
                />
              )
            : (
                <span className="text-lg">📄</span>
              )}
        </div>
        <div className="ml-3 w-0 grow">
          <div className="flex h-5 items-center">
            <span className="system-md-semibold truncate text-text-secondary">{name}</span>
          </div>
          <div className="system-2xs-medium-uppercase mt-0.5 truncate text-text-tertiary">
            by
            {' '}
            {author}
          </div>
        </div>
      </div>

      {/* Description */}
      <div
        className="system-xs-regular mt-3 line-clamp-2 text-text-tertiary"
        title={descriptionText}
      >
        {descriptionText}
      </div>

      {/* Tags */}
      {tags && tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="system-2xs-medium-uppercase bg-components-badge-bg-gray rounded-md px-1.5 py-0.5 text-text-tertiary"
            >
              {tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="system-2xs-medium-uppercase text-text-quaternary">
              +
              {tags.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const TemplateCard = React.memo(TemplateCardComponent)

export default TemplateCard
