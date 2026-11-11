export const emojiStyles = [
  {
    background: '#FEF3F2',
    label: 'iconPicker.color.red' as const,
    backgroundClassName: 'bg-components-icon-bg-red-soft',
    selectedClassName: 'ring-util-colors-red-red-400',
  },
  {
    background: '#FFF1F3',
    label: 'iconPicker.color.rose' as const,
    backgroundClassName: 'bg-components-icon-bg-rose-soft',
    selectedClassName: 'ring-util-colors-rose-rose-400',
  },
  {
    background: '#FDF2FA',
    label: 'iconPicker.color.pink' as const,
    backgroundClassName: 'bg-components-icon-bg-pink-soft',
    selectedClassName: 'ring-util-colors-pink-pink-400',
  },
  {
    background: '#FFF4ED',
    label: 'iconPicker.color.orange' as const,
    backgroundClassName: 'bg-components-icon-bg-orange-dark-soft',
    selectedClassName: 'ring-util-colors-orange-dark-orange-dark-400',
  },
  {
    background: '#FEFBE8',
    label: 'iconPicker.color.yellow' as const,
    backgroundClassName: 'bg-components-icon-bg-yellow-soft',
    selectedClassName: 'ring-util-colors-yellow-yellow-400',
  },
  {
    background: '#F3FEE7',
    label: 'iconPicker.color.green' as const,
    backgroundClassName: 'bg-components-icon-bg-green-soft',
    selectedClassName: 'ring-util-colors-green-green-400',
  },
  {
    background: '#F0FDF9',
    label: 'iconPicker.color.teal' as const,
    backgroundClassName: 'bg-components-icon-bg-teal-soft',
    selectedClassName: 'ring-util-colors-teal-teal-400',
  },
  {
    background: '#F0F9FF',
    label: 'iconPicker.color.lightBlue' as const,
    backgroundClassName: 'bg-components-icon-bg-blue-light-soft',
    selectedClassName: 'ring-util-colors-blue-light-blue-light-400',
  },
  {
    background: '#E9F0FF',
    label: 'iconPicker.color.blue' as const,
    backgroundClassName: 'bg-components-icon-bg-blue-soft',
    selectedClassName: 'ring-util-colors-blue-blue-400',
  },
  {
    background: '#F5F3FF',
    label: 'iconPicker.color.violet' as const,
    backgroundClassName: 'bg-components-icon-bg-violet-soft',
    selectedClassName: 'ring-util-colors-violet-violet-400',
  },
  {
    background: '#EEF4FF',
    label: 'iconPicker.color.indigo' as const,
    backgroundClassName: 'bg-components-icon-bg-indigo-soft',
    selectedClassName: 'ring-util-colors-indigo-indigo-400',
  },
  {
    background: '#F0F2F5',
    label: 'iconPicker.color.gray' as const,
    backgroundClassName: 'bg-components-icon-bg-midnight-soft',
    selectedClassName: 'ring-util-colors-midnight-midnight-400',
  },
]

export const defaultEmojiBackground = emojiStyles[0]!.background

export const recommendedEmojis = [
  '😃',
  '😆',
  '🥹',
  '😅',
  '😂',
  '🤣',
  '🥲',
  '☺️',
  '😊',
  '😇',
  '🙂',
  '😍',
  '😘',
  '😙',
  '😝',
  '🤪',
  '🤓',
  '😎',
  '🥸',
  '🤩',
  '🥳',
  '😤',
  '🤯',
  '🥵',
  '🥶',
]

export function getRandomEmoji(current?: string) {
  const candidates = recommendedEmojis.filter((emoji) => emoji !== current)
  return candidates[Math.floor(Math.random() * candidates.length)]!
}

export function getRandomEmojiBackground(current = defaultEmojiBackground) {
  const candidates = emojiStyles.filter((style) => style.background !== current.toUpperCase())
  return candidates[Math.floor(Math.random() * candidates.length)]!.background
}
