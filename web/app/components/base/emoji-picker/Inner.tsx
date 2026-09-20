'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { InputGroup, InputGroupAddon } from '@langgenius/dify-ui/input-group'
import { EmojiPicker } from 'frimousse'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { resolveEmoji } from '@/utils/emoji'
import { basePath } from '@/utils/var'
import { backgroundColors, defaultEmojiBackground } from './constants'

type IEmojiPickerInnerProps = {
  emoji?: string
  background?: string
  onSelect?: (emoji: string, background: string) => void
  className?: string
}

const listComponents: NonNullable<React.ComponentProps<typeof EmojiPicker.List>['components']> = {
  CategoryHeader: ({ category, ...props }) => (
    <div
      {...props}
      className="bg-components-panel-bg px-3 pb-1 system-xs-medium-uppercase text-text-primary"
    >
      {category.label}
    </div>
  ),
  Row: ({ children, ...props }) => (
    <div {...props} className="scroll-my-1 gap-1 px-3 pb-1">
      {children}
    </div>
  ),
  Emoji: ({ emoji, ...props }) => (
    <button
      {...props}
      type="button"
      className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg text-xl focus-visible:outline-2 focus-visible:outline-offset-2 data-[active]:bg-state-base-hover"
    >
      {emoji.emoji}
    </button>
  ),
}

function EmojiPickerInner({ emoji, background, onSelect, className }: IEmojiPickerInnerProps) {
  const { t } = useTranslation()
  const [selectedEmoji, setSelectedEmoji] = useState(() => (emoji ? resolveEmoji(emoji) : ''))
  const [selectedBackground, setSelectedBackground] = useState(background || defaultEmojiBackground)
  const [showStyleColors, setShowStyleColors] = useState(!!emoji)

  const styleColorsLabelId = React.useId()

  const handleEmojiSelect = (emoji: string) => {
    setSelectedEmoji(emoji)
    setShowStyleColors(true)
    onSelect?.(emoji, selectedBackground)
  }

  const handleBackgroundSelect = (background: string) => {
    setSelectedBackground(background)
    if (selectedEmoji) onSelect?.(selectedEmoji, background)
  }

  return (
    <div className={cn(className, 'flex min-h-0 w-full min-w-0 flex-col')}>
      <EmojiPicker.Root
        className="flex min-h-0 flex-1 flex-col"
        locale="en"
        columns={8}
        emojibaseUrl={`${basePath}/emoji/emojibase-17.0.0`}
        onEmojiSelect={({ emoji }) => handleEmojiSelect(emoji)}
      >
        <div className="px-3 pb-2">
          <InputGroup>
            <EmojiPicker.Search
              aria-label={t(($) => $['operation.search'], { ns: 'common' })}
              placeholder={t(($) => $['operation.search'], { ns: 'common' })}
              className="h-8 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-hover"
            />
            <InputGroupAddon className="ps-3 pe-2">
              <span
                className="i-heroicons-magnifying-glass size-5 text-text-quaternary"
                aria-hidden="true"
              />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <Divider className="my-3" />
        <EmojiPicker.Viewport className="relative h-50 min-h-0 w-full overflow-x-hidden overflow-y-auto">
          <EmojiPicker.Loading className="block p-3 text-text-tertiary">
            {t(($) => $.loading, { ns: 'common' })}
          </EmojiPicker.Loading>
          <EmojiPicker.Empty className="block p-3 text-text-tertiary">
            {t(($) => $.noData, { ns: 'common' })}
          </EmojiPicker.Empty>
          <EmojiPicker.List components={listComponents} />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>

      {/* Color Select */}
      <div className={cn('flex shrink-0 items-center justify-between p-3 pb-0')}>
        <p id={styleColorsLabelId} className="mb-2 system-xs-medium-uppercase text-text-primary">
          Choose Style
        </p>
        {showStyleColors ? (
          <button
            type="button"
            aria-labelledby={styleColorsLabelId}
            aria-expanded="true"
            className="i-heroicons-chevron-down size-4 cursor-pointer border-none bg-transparent p-0 text-text-quaternary focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => setShowStyleColors(!showStyleColors)}
          />
        ) : (
          <button
            type="button"
            aria-labelledby={styleColorsLabelId}
            aria-expanded="false"
            className="i-heroicons-chevron-up size-4 cursor-pointer border-none bg-transparent p-0 text-text-quaternary focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => setShowStyleColors(!showStyleColors)}
          />
        )}
      </div>
      {showStyleColors && (
        <div className="grid w-full shrink-0 grid-cols-8 gap-1 px-3">
          {backgroundColors.map((color) => {
            return (
              <button
                type="button"
                key={color}
                aria-label={color}
                className={cn(
                  'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2',
                  'border-none bg-transparent p-0',
                  'ring-components-input-border-hover ring-offset-1 hover:ring-1',
                  'inline-flex h-10 w-full min-w-0 items-center justify-center rounded-lg',
                  color === selectedBackground ? 'ring-1 ring-components-input-border-hover' : '',
                )}
                onClick={() => {
                  handleBackgroundSelect(color)
                }}
              >
                <span
                  className={cn(
                    'flex size-8 max-w-full items-center justify-center rounded-lg p-1 text-xl',
                  )}
                  style={{ background: color }}
                >
                  {selectedEmoji}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
export default EmojiPickerInner
