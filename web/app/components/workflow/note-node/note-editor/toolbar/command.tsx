import { cn } from '@langgenius/dify-ui/cn'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { useCommand } from './hooks'

type CommandProps = {
  type: 'bold' | 'italic' | 'strikethrough' | 'link' | 'bullet'
}
const Command = ({ type }: CommandProps) => {
  const { t } = useTranslation(['workflow'])
  const selectedIsBold = useStore((s) => s.selectedIsBold)
  const selectedIsItalic = useStore((s) => s.selectedIsItalic)
  const selectedIsStrikeThrough = useStore((s) => s.selectedIsStrikeThrough)
  const selectedIsLink = useStore((s) => s.selectedIsLink)
  const selectedIsBullet = useStore((s) => s.selectedIsBullet)
  const { handleCommand } = useCommand()

  const icon = useMemo(() => {
    switch (type) {
      case 'bold':
        return (
          <span
            aria-hidden
            className={cn('i-ri-bold size-4', selectedIsBold && 'text-primary-600')}
          />
        )
      case 'italic':
        return (
          <span
            aria-hidden
            className={cn('i-ri-italic size-4', selectedIsItalic && 'text-primary-600')}
          />
        )
      case 'strikethrough':
        return (
          <span
            aria-hidden
            className={cn(
              'i-ri-strikethrough size-4',
              selectedIsStrikeThrough && 'text-primary-600',
            )}
          />
        )
      case 'link':
        return (
          <span
            aria-hidden
            className={cn('i-ri-link size-4', selectedIsLink && 'text-primary-600')}
          />
        )
      case 'bullet':
        return (
          <span
            aria-hidden
            className={cn('i-ri-list-unordered size-4', selectedIsBullet && 'text-primary-600')}
          />
        )
    }
  }, [
    type,
    selectedIsBold,
    selectedIsItalic,
    selectedIsStrikeThrough,
    selectedIsLink,
    selectedIsBullet,
  ])

  const pressed = {
    bold: selectedIsBold,
    italic: selectedIsItalic,
    strikethrough: selectedIsStrikeThrough,
    link: selectedIsLink,
    bullet: selectedIsBullet,
  }[type]

  const tip = useMemo(() => {
    switch (type) {
      case 'bold':
        return t(($) => $['nodes.note.editor.bold'], { ns: 'workflow' })
      case 'italic':
        return t(($) => $['nodes.note.editor.italic'], { ns: 'workflow' })
      case 'strikethrough':
        return t(($) => $['nodes.note.editor.strikethrough'], { ns: 'workflow' })
      case 'link':
        return t(($) => $['nodes.note.editor.link'], { ns: 'workflow' })
      case 'bullet':
        return t(($) => $['nodes.note.editor.bulletList'], { ns: 'workflow' })
    }
  }, [type, t])

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={tip}
            pressed={pressed}
            onPressedChange={() => handleCommand(type)}
            className="flex size-8 items-center justify-center rounded-md text-text-tertiary hover:bg-state-accent-active hover:text-text-accent data-pressed:bg-state-accent-active"
          >
            {icon}
          </Toggle>
        }
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

export default memo(Command)
