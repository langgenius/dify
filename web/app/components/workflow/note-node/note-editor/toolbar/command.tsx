import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import {
  RiBold,
  RiItalic,
  RiLink,
  RiListUnordered,
  RiStrikethrough,
} from '@remixicon/react'
import { useStore } from '../store'
import { useCommand } from './hooks'
import TooltipPlus from '@/app/components/base/tooltip-plus'

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
        return <RiBold className={cn('w-4 h-4', selectedIsBold && 'text-primary-600')} />
      case 'italic':
        return <RiItalic className={cn('w-4 h-4', selectedIsItalic && 'text-primary-600')} />
      case 'strikethrough':
        return <RiStrikethrough className={cn('w-4 h-4', selectedIsStrikeThrough && 'text-primary-600')} />
      case 'link':
        return <RiLink className={cn('w-4 h-4', selectedIsLink && 'text-primary-600')} />
      case 'bullet':
        return <RiListUnordered className={cn('w-4 h-4', selectedIsBullet && 'text-primary-600')} />
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
    <TooltipPlus popupContent={tip}>
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 cursor-pointer rounded-md text-gray-500 hover:text-gray-800 hover:bg-black/5',
          type === 'bold' && selectedIsBold && 'bg-primary-50',
          type === 'italic' && selectedIsItalic && 'bg-primary-50',
          type === 'strikethrough' && selectedIsStrikeThrough && 'bg-primary-50',
          type === 'link' && selectedIsLink && 'bg-primary-50',
          type === 'bullet' && selectedIsBullet && 'bg-primary-50',
        )}
        onClick={() => handleCommand(type)}
      >
        {icon}
      </div>
    </TooltipPlus>
  )
}

export default memo(Command)
