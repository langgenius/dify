import type { FC } from 'react'
import { useState } from 'react'
import cn from 'classnames'
import { useDebounceFn } from 'ahooks'
import TagRemoveModal from './tag-remove-modal'
import { Edit03, Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import type { Tag } from '@/app/components/base/tag-management/constant'

type TagItemEditorProps = {
  tag: Tag
  onRemove: (tagID: string) => void
}
const TagItemEditor: FC<TagItemEditorProps> = ({
  tag,
  onRemove,
}) => {
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const { run: handleRemove } = useDebounceFn(() => {
    onRemove(tag.id)
  }, { wait: 200 })

  return (
    <>
      <div className={cn('shrink-0 flex items-center gap-0.5 pr-1 pl-2 rounded-lg border border-gray-200 text-sm leading-5 text-gray-700 outline-none appearance-none  placeholder:text-gray-300 caret-primary-600 focus:border-solid')}>
        <div className='text-sm leading-5 text-gray-700'>
          {tag.name}
        </div>
        <div className='shrink-0 px-1 text-sm leading-4.5 text-gray-500 font-medium'>{tag.binding_count}</div>
        <div className='group/edit shrink-0 p-1 rounded-md cursor-pointer hover:bg-black/5' onClick={handleRemove}>
          <Edit03 className='w-3 h-3 text-gray-500 group-hover/edit:text-gray-800' />
        </div>
        <div className='group/remove shrink-0 p-1 rounded-md cursor-pointer hover:bg-black/5' onClick={() => {
          if (tag.binding_count)
            setShowRemoveModal(true)
          else
            handleRemove()
        }}>
          <Trash03 className='w-3 h-3 text-gray-500 group-hover/remove:text-gray-800' />
        </div>
      </div>
      <TagRemoveModal
        tag={tag}
        show={showRemoveModal}
        onConfirm={() => {
          handleRemove()
          setShowRemoveModal(false)
        }}
        onClose={() => setShowRemoveModal(false)}
      />
    </>
  )
}

export default TagItemEditor
