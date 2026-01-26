import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { useStore } from '../store'
import { useCommand } from './hooks'

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
        return <span className={`i-ri-bold ${cn('h-4 w-4', selectedIsBold && 'text-primary-600')}`} />
      case 'italic':
        return <span className={`i-ri-italic ${cn('h-4 w-4', selectedIsItalic && 'text-primary-600')}`} />
      case 'strikethrough':
        return <span className={`i-ri-strikethrough ${cn('h-4 w-4', selectedIsStrikeThrough && 'text-primary-600')}`} />
      case 'link':
        return <span className={`i-ri-link ${cn('h-4 w-4', selectedIsLink && 'text-primary-600')}`} />
      case 'bullet':
        return <span className={`i-ri-list-unordered ${cn('h-4 w-4', selectedIsBullet && 'text-primary-600')}`} />
    }
  }, [type, selectedIsBold, selectedIsItalic, selectedIsStrikeThrough, selectedIsLink, selectedIsBullet])

  const tip = useMemo(() => {
    switch (type) {
      case 'bold':
        return t('nodes.note.editor.bold', { ns: 'workflow' })
      case 'italic':
        return t('nodes.note.editor.italic', { ns: 'workflow' })
      case 'strikethrough':
        return t('nodes.note.editor.strikethrough', { ns: 'workflow' })
      case 'link':
        return t('nodes.note.editor.link', { ns: 'workflow' })
      case 'bullet':
        return t('nodes.note.editor.bulletList', { ns: 'workflow' })
    }
  }, [type, t])

  return (
    <Tooltip
      popupContent={tip}
    >
      <div
        className={cn(
          'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-accent-active hover:text-text-accent',
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
