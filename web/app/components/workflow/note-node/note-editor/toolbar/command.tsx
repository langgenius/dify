import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiBold,
  RiItalic,
  RiLink,
  RiListUnordered,
  RiStrikethrough,
} from '@remixicon/react'
import { useStore } from '../store'
import { useCommand } from './hooks'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'

type CommandProps = {
  type: 'bold' | 'italic' | 'strikethrough' | 'link' | 'bullet'
}
const Command = ({
  type,
}: CommandProps) => {
  const { t } = useTranslation()
  const selectedIsBold = useStore(s => s.selectedIsBold)
  const selectedIsItalic = useStore(s => s.selectedIsItalic)
  const selectedIsStrikeThrough = useStore(s => s.selectedIsStrikeThrough)
  const selectedIsLink = useStore(s => s.selectedIsLink)
  const selectedIsBullet = useStore(s => s.selectedIsBullet)
  const { handleCommand } = useCommand()

  const icon = useMemo(() => {
    switch (type) {
      case 'bold':
        return <RiBold className={cn('h-4 w-4', selectedIsBold && 'text-primary-600')} />
      case 'italic':
        return <RiItalic className={cn('h-4 w-4', selectedIsItalic && 'text-primary-600')} />
      case 'strikethrough':
        return <RiStrikethrough className={cn('h-4 w-4', selectedIsStrikeThrough && 'text-primary-600')} />
      case 'link':
        return <RiLink className={cn('h-4 w-4', selectedIsLink && 'text-primary-600')} />
      case 'bullet':
        return <RiListUnordered className={cn('h-4 w-4', selectedIsBullet && 'text-primary-600')} />
    }
  }, [type, selectedIsBold, selectedIsItalic, selectedIsStrikeThrough, selectedIsLink, selectedIsBullet])

  const tip = useMemo(() => {
    switch (type) {
      case 'bold':
        return t('workflow.nodes.note.editor.bold')
      case 'italic':
        return t('workflow.nodes.note.editor.italic')
      case 'strikethrough':
        return t('workflow.nodes.note.editor.strikethrough')
      case 'link':
        return t('workflow.nodes.note.editor.link')
      case 'bullet':
        return t('workflow.nodes.note.editor.bulletList')
    }
  }, [type, t])

  return (
    <Tooltip
      popupContent={tip}
    >
      <div
        className={cn(
          'text-text-tertiary hover:text-text-accent hover:bg-state-accent-active flex h-8 w-8 cursor-pointer items-center justify-center rounded-md',
          type === 'bold' && selectedIsBold && 'bg-state-accent-active',
          type === 'italic' && selectedIsItalic && 'bg-state-accent-active',
          type === 'strikethrough' && selectedIsStrikeThrough && 'bg-state-accent-active',
          type === 'link' && selectedIsLink && 'bg-state-accent-active',
          type === 'bullet' && selectedIsBullet && 'bg-state-accent-active',
        )}
        onClick={() => handleCommand(type)}
      >
        {icon}
      </div>
    </Tooltip>
  )
}

export default memo(Command)
