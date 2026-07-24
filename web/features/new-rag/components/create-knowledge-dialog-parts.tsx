'use client'

import type { ReactNode } from 'react'
import type { NewKnowledgeStartMode } from '../routes'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioControl, RadioItem } from '@langgenius/dify-ui/radio'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

export function StartMode({
  children,
  description,
  disabled = false,
  icon,
  selected = false,
  title,
  value,
}: {
  children?: ReactNode
  description: string
  disabled?: boolean
  icon: string
  selected?: boolean
  title: string
  value: NewKnowledgeStartMode
}) {
  const { t } = useTranslation('dataset')
  const titleId = useId()
  const descriptionId = useId()
  const unavailableId = useId()

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg transition-colors motion-reduce:transition-none',
        selected &&
          'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg',
      )}
    >
      <RadioItem
        value={value}
        nativeButton
        render={<button type="button" />}
        aria-labelledby={titleId}
        aria-describedby={disabled ? `${descriptionId} ${unavailableId}` : descriptionId}
        disabled={disabled}
        className={cn(
          'relative flex min-h-16 w-full items-center gap-3 px-4 py-3.5 text-left outline-hidden',
          'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent',
        )}
      >
        <RadioControl aria-hidden />
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-option-card-option-border bg-background-default">
          <span aria-hidden className={`${icon} size-[18px] text-text-accent`} />
        </span>
        <span className="min-w-0 flex-1">
          <span id={titleId} className="block system-sm-medium text-text-primary">
            {title}
          </span>
          <span id={descriptionId} className="mt-0.5 block system-xs-regular text-text-tertiary">
            {description}
          </span>
        </span>
        {value === 'source' && (
          <span
            aria-hidden
            className="h-4 w-[82px] shrink-0 bg-[url('/images/new-rag/create-knowledge-connectors.svg')] bg-contain bg-center bg-no-repeat"
          />
        )}
        {disabled && (
          <span id={unavailableId} className="ml-3 shrink-0 system-xs-medium text-text-disabled">
            {t(($) => $['cornerLabel.unavailable'])}
          </span>
        )}
      </RadioItem>
      {selected && children}
    </div>
  )
}

export function KnowledgeIllustration({ title }: { title: string }) {
  return (
    <div className="flex size-full flex-col items-start bg-background-default" aria-hidden>
      <div className="min-h-0 w-full flex-1 border-b border-divider-subtle" />
      <div className="flex max-h-full w-full shrink-0 flex-col items-start overflow-hidden pb-[94px]">
        <div className="flex w-full shrink-0 flex-col items-start gap-4 overflow-hidden py-4 pr-32 pl-8">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] backdrop-blur-[6px]">
            <span className="flex size-full items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 text-text-accent">
              <span className="i-ri-book-open-line size-6" />
            </span>
          </span>
          <p className="w-full body-2xl-regular font-medium tracking-[-0.09px] text-text-primary">
            {title}
          </p>
        </div>
        <div className="aspect-[1489/840] w-full shrink-0 overflow-hidden">
          <img
            alt=""
            className="block size-full max-w-none object-contain"
            src="/images/new-rag/create-knowledge-illustration.svg"
          />
        </div>
      </div>
      <div className="min-h-0 w-full flex-1" />
    </div>
  )
}
