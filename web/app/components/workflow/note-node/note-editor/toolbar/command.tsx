import { memo, useMemo } from 'react'
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
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
  const [editor] = useLexicalComposerContext()

  const icon = useMemo(() => {
    switch (type) {
      case 'bold':
        return <Bold01 className='w-4 h-4' />
      case 'strikethrough':
        return <Strikethrough01 className='w-4 h-4' />
      case 'link':
        return <Link01 className='w-4 h-4' />
      case 'bullet':
        return <Dotpoints01 className='w-4 h-4' />
    }
  }, [type])

  const handleClick = () => {
    if (type === 'bold')
      return

    if (type === 'link') {
      editor.update(() => {
        const selection = $getSelection()

        if ($isRangeSelection(selection) && !selection.isCollapsed())
          $setSelection(selection)
      })
    }
  }

  return (
    <div
      className='flex items-center justify-center w-8 h-8 cursor-pointer rounded-md text-gray-500 hover:text-gray-800 hover:bg-black/5'
      onClick={handleClick}
    >
      {icon}
    </div>
  )
}

export default memo(Command)
