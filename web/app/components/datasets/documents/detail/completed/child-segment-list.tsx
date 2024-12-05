import { type FC, useMemo, useState } from 'react'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { FormattedText } from '../../../formatted-text/formatted'
import { EditSlice } from '../../../formatted-text/flavours/edit-slice'
import { useDocumentContext } from '../index'
import type { ChildChunkDetail } from '@/models/datasets'
import Input from '@/app/components/base/input'
import classNames from '@/utils/classnames'
import Divider from '@/app/components/base/divider'

type IChildSegmentCardProps = {
  childChunks: ChildChunkDetail[]
  handleInputChange: (value: string) => void
  enabled: boolean
}

const ChildSegmentList: FC<IChildSegmentCardProps> = ({
  childChunks,
  handleInputChange,
  enabled,
}) => {
  const parentMode = useDocumentContext(s => s.parentMode)

  const [collapsed, setCollapsed] = useState(true)

  const toggleCollapse = () => {
    setCollapsed(!collapsed)
  }

  const isParagraphMode = useMemo(() => {
    return parentMode === 'paragraph'
  }, [parentMode])

  const isFullDocMode = useMemo(() => {
    return parentMode === 'full-doc'
  }, [parentMode])

  const contentOpacity = useMemo(() => {
    return enabled ? '' : 'opacity-50 group-hover/card:opacity-100'
  }, [enabled])

  return (
    <div className={classNames('flex flex-col', contentOpacity, isParagraphMode ? 'p-1 pb-2' : 'px-3 grow overflow-y-hidden')}>
      {isFullDocMode ? <Divider type='horizontal' className='h-[1px] bg-divider-subtle my-1' /> : null}
      <div className={classNames('flex items-center justify-between', isFullDocMode ? 'pt-2 pb-3' : '')}>
        <div className={classNames('h-7 flex items-center pl-1 pr-3 rounded-lg', (isParagraphMode && collapsed) ? 'bg-dataset-child-chunk-expand-btn-bg' : '')} onClick={(event) => {
          event.stopPropagation()
          toggleCollapse()
        }}>
          {
            isParagraphMode
              ? collapsed
                ? (
                  <RiArrowRightSLine className='w-4 h-4 text-text-secondary opacity-50 mr-0.5' />
                )
                : (<RiArrowDownSLine className='w-4 h-4 text-text-secondary mr-0.5' />)
              : null
          }
          <span className='text-text-secondary system-sm-semibold-uppercase'>{`${childChunks.length} CHILD CHUNKS`}</span>
          <span className={classNames('text-text-quaternary text-xs font-medium pl-1.5', isParagraphMode ? 'hidden group-hover/card:inline-block' : '')}>·</span>
          <button
            className={classNames('px-1.5 py-1 text-components-button-secondary-accent-text system-xs-semibold', isParagraphMode ? 'hidden group-hover/card:inline-block' : '')}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            ADD
          </button>
        </div>
        {isFullDocMode
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
      {(isFullDocMode || !collapsed)
        ? <div className={classNames('flex gap-x-0.5', isFullDocMode ? 'grow overflow-y-auto' : '')}>
          {isParagraphMode && <Divider type='vertical' className='h-auto w-[2px] mx-[7px] bg-text-accent-secondary' />}
          <FormattedText className={classNames('w-full !leading-5 flex flex-col', isParagraphMode ? 'gap-y-2' : 'gap-y-3')}>
            {childChunks.map((childChunk) => {
              return <EditSlice
                key={childChunk.segment_id}
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
