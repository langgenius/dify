import {
  memo,
  useMemo,
} from 'react'
import cn from 'classnames'
import { useStore } from '../store'
import { useCommand } from './hooks'
import { Link01 } from '@/app/components/base/icons/src/vender/line/general'
import {
  Bold01,
  Dotpoints01,
  Strikethrough01,
} from '@/app/components/base/icons/src/vender/line/editor'

type CommandProps = {
  type: 'bold' | 'strikethrough' | 'link' | 'bullet'
}
const Command = ({
  type,
}: CommandProps) => {
  const isBold = useStore(s => s.isBold)
  const isStrikeThrough = useStore(s => s.isStrikeThrough)
  const isLink = useStore(s => s.isLink)
  console.log(isBold)
  const { handleCommand } = useCommand()

  const icon = useMemo(() => {
    switch (type) {
      case 'bold':
        return <Bold01 className={cn('w-4 h-4', isBold && 'text-primary-600')} />
      case 'strikethrough':
        return <Strikethrough01 className={cn('w-4 h-4', isStrikeThrough && 'text-primary-600')} />
      case 'link':
        return <Link01 className={cn('w-4 h-4', isLink && 'text-primary-600')} />
      case 'bullet':
        return <Dotpoints01 className='w-4 h-4' />
    }
  }, [type, isBold, isStrikeThrough, isLink])

  return (
    <div
      className={cn(
        'flex items-center justify-center w-8 h-8 cursor-pointer rounded-md text-gray-500 hover:text-gray-800 hover:bg-black/5',
        type === 'bold' && isBold && 'bg-primary-50',
        type === 'strikethrough' && isStrikeThrough && 'bg-primary-50',
        type === 'link' && isLink && 'bg-primary-50',
      )}
      onClick={() => handleCommand(type)}
    >
      {icon}
    </div>
  )
}

export default memo(Command)
