import { type FC, useState } from 'react'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { FormattedText } from '../../../formatted-text/formatted'
import { EditSlice } from '../../../formatted-text/flavours/edit-slice'
import { useDocumentContext } from '../index'
import type { ChildChunkDetail } from '@/models/datasets'
import Input from '@/app/components/base/input'
import classNames from '@/utils/classnames'
import Divider from '@/app/components/base/divider'

type IChildSegmentCardProps = {
  child_chunks: ChildChunkDetail[]
  onSave: () => void
  handleInputChange: (value: string) => void
}

const ChildSegmentList: FC<IChildSegmentCardProps> = ({
  child_chunks,
  onSave,
  handleInputChange,
}) => {
  let parentMode = useDocumentContext(s => s.parentMode)
  parentMode = 'paragraph'
  const [collapsed, setCollapsed] = useState(true)

  const toggleCollapse = () => {
    setCollapsed(!collapsed)
  }

  return (
    <div className='flex flex-col p-1 pb-2'>
      <div className='flex items-center justify-between'>
        <div className={classNames('h-7 flex items-center pl-1 pr-3 rounded-lg', collapsed ? 'bg-dataset-child-chunk-expand-btn-bg' : '')} onClick={(event) => {
          event.stopPropagation()
          toggleCollapse()
        }}>
          {
            parentMode === 'paragraph'
              ? collapsed
                ? (
                  <RiArrowRightSLine className='w-4 h-4 text-text-secondary opacity-50 mr-0.5' />
                )
                : (<RiArrowDownSLine className='w-4 h-4 text-text-secondary mr-0.5' />)
              : null
          }
          <span className='text-text-secondary system-sm-semibold-uppercase'>{`${child_chunks.length} CHILD CHUNKS`}</span>
          <span className='hidden group-hover/card:inline-block text-text-quaternary text-xs font-medium pl-1.5'>·</span>
          <button className='hidden group-hover/card:inline-block px-1.5 py-1 text-components-button-secondary-accent-text system-xs-semibold'>ADD</button>
        </div>
        {parentMode === 'full-doc'
          ? <Input
            showLeftIcon
            showClearIcon
            wrapperClassName='!w-52'
            value={''}
            onChange={e => handleInputChange(e.target.value)}
            onClear={() => handleInputChange('')}
          />
          : null}
      </div>
      {(parentMode === 'full-doc' || !collapsed)
        ? <div className='flex gap-x-0.5 p-1'>
          <Divider type='vertical' className='h-auto w-[2px] mx-[7px] bg-text-accent-secondary' />
          <FormattedText className='w-full !leading-5'>
            {child_chunks.map((childChunk, index) => {
              return <EditSlice
                key={index}
                label={`C-${childChunk.position}`}
                text={childChunk.content}
                onDelete={() => {}}
                className=''
              />
            })}
          </FormattedText>
        </div>

        : null}
    </div>
  )
}

export default ChildSegmentList
