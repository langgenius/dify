'use client'
import type { EmojiPickerListEmojiProps } from 'frimousse'
import { cn } from '@langgenius/dify-ui/cn'
import { EmojiPicker } from 'frimousse'
import * as React from 'react'
import { createContext, use, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveEmoji } from '@/utils/emoji'
import { basePath } from '@/utils/var'
import { defaultEmojiBackground, emojiStyles, recommendedEmojis } from './constants'
import { useRecentEmojisValue } from './storage'

type IEmojiPickerInnerProps = {
  emoji?: string
  background?: string
  onSelect?: (emoji: string, background: string) => void
  className?: string
}

const emojiButtonClassName =
  'flex h-8 w-full min-w-0 max-w-8 flex-1 items-center justify-center rounded-lg text-2xl leading-none hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-state-accent-solid data-[active]:bg-state-base-hover aria-pressed:ring-[1.5px] aria-pressed:ring-components-option-card-option-selected-border aria-pressed:ring-inset'

const SelectedEmojiContext = createContext('')

function EmojiButton({ emoji, ...props }: EmojiPickerListEmojiProps) {
  const selectedEmoji = use(SelectedEmojiContext)
  return (
    <button
      {...props}
      type="button"
      aria-pressed={selectedEmoji === emoji.emoji}
      className={emojiButtonClassName}
    >
      {emoji.emoji}
    </button>
  )
}

const listComponents: NonNullable<React.ComponentProps<typeof EmojiPicker.List>['components']> = {
  CategoryHeader: ({ category, ...props }) => (
    <div
      {...props}
      className="bg-components-panel-bg px-3.5 py-1 system-xs-medium-uppercase text-text-tertiary"
    >
      {category.label}
    </div>
  ),
  Row: ({ children, ...props }) => (
    <div {...props} className="scroll-my-1 gap-px px-3 pb-px">
      {children}
    </div>
  ),
  Emoji: EmojiButton,
}

function EmojiPickerInner({ emoji, background, onSelect, className }: IEmojiPickerInnerProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const recentEmojis = useRecentEmojisValue()
  const selectedEmoji = emoji ? resolveEmoji(emoji) : ''
  const handleEmojiSelect = (value: string) =>
    onSelect?.(value, background || defaultEmojiBackground)

  const renderGroup = (label: string, emojis: string[]) => (
    <section aria-label={label} className="px-3 pb-2">
      <h3 className="px-0.5 py-1 system-xs-medium-uppercase text-text-tertiary">{label}</h3>
      <div className="grid grid-cols-9 gap-px">
        {emojis.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={value}
            aria-pressed={selectedEmoji === value}
            className={emojiButtonClassName}
            onClick={() => handleEmojiSelect(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </section>
  )

  return (
    <EmojiPicker.Root
      className={cn('flex min-h-0 w-full min-w-0 flex-col', className)}
      locale="en"
      columns={9}
      emojibaseUrl={`${basePath}/emoji/emojibase-17.0.0`}
      onEmojiSelect={({ emoji }) => handleEmojiSelect(emoji)}
      onKeyUp={(event) => {
        if (
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
        ) {
          scrollRef.current
            ?.querySelector<HTMLElement>('[frimousse-emoji][data-active]')
            ?.scrollIntoView({ block: 'nearest' })
        }
      }}
    >
      <div className="shrink-0 border-b border-divider-subtle px-3 pb-2">
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-transparent bg-components-input-bg-normal px-2 focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active">
          <span
            className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <EmojiPicker.Search
            aria-label={t(($) => $['iconPicker.search'], { ns: 'app' })}
            placeholder={t(($) => $['iconPicker.search'], { ns: 'app' })}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              scrollRef.current?.scrollTo({ top: 0 })
            }}
            className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 system-sm-regular text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
      </div>
      <div
        ref={scrollRef}
        role="region"
        aria-label={t(($) => $['iconPicker.emoji'], { ns: 'app' })}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="py-2">
          {!search && (
            <div className="shrink-0">
              {!!recentEmojis.length &&
                renderGroup(
                  t(($) => $['iconPicker.recent'], { ns: 'app' }),
                  recentEmojis,
                )}
              {renderGroup(
                t(($) => $['iconPicker.recommend'], { ns: 'app' }),
                recommendedEmojis,
              )}
            </div>
          )}
          <EmojiPicker.Viewport
            className="relative w-full"
            // The outer scroller owns all groups; let this viewport grow with its list.
            style={{
              contain: 'none',
              containIntrinsicSize: 'none',
              overflow: 'visible',
              scrollbarGutter: 'auto',
              willChange: 'auto',
            }}
          >
            <EmojiPicker.Loading className="block p-3 text-text-tertiary">
              {t(($) => $.loading, { ns: 'common' })}
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="block p-3 text-text-tertiary">
              {t(($) => $.noData, { ns: 'common' })}
            </EmojiPicker.Empty>
            <SelectedEmojiContext value={selectedEmoji}>
              <EmojiPicker.List components={listComponents} />
            </SelectedEmojiContext>
          </EmojiPicker.Viewport>
        </div>
      </div>
      {selectedEmoji && (
        <section
          aria-label={t(($) => $['iconPicker.chooseStyle'], { ns: 'app' })}
          className="shrink-0 border-t border-divider-subtle bg-components-panel-bg-blur px-3 pt-2 pb-3 backdrop-blur-sm"
        >
          <h3 className="px-0.5 py-1 system-xs-semibold-uppercase text-text-primary">
            {t(($) => $['iconPicker.chooseStyle'], { ns: 'app' })}
          </h3>
          <div className="grid grid-cols-6 justify-items-center gap-0.75 pt-0.5">
            {emojiStyles.map((style) => (
              <button
                key={style.background}
                type="button"
                aria-label={style.background}
                aria-pressed={
                  (background || defaultEmojiBackground).toUpperCase() === style.background
                }
                className={cn(
                  'flex aspect-square w-full max-w-11.5 items-center justify-center rounded-xl p-0.75 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid',
                  (background || defaultEmojiBackground).toUpperCase() === style.background && [
                    'ring-[1.5px]',
                    style.selectedClassName,
                  ],
                )}
                onClick={() => onSelect?.(selectedEmoji, style.background)}
              >
                <span
                  className={cn(
                    'flex aspect-square w-full items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular text-2xl leading-none',
                    style.backgroundClassName,
                  )}
                >
                  {selectedEmoji}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </EmojiPicker.Root>
  )
}
export default EmojiPickerInner
