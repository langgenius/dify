import type { FC, PropsWithChildren } from 'react'
import { SelectionMod } from '../base/icons/src/public/knowledge'
import type { QA } from '@/models/datasets'

export type ChunkLabelProps = {
  label: string
  characterCount: number
}

export const ChunkLabel: FC<ChunkLabelProps> = (props) => {
  const { label, characterCount } = props
  return <div className='text-text-tertiary flex items-center text-xs font-medium'>
    <SelectionMod className='size-[10px]' />
    <p className='ml-0.5 flex gap-2'>
      <span>
        {label}
      </span>
      <span>
        ·
      </span>
      <span>
        {`${characterCount} characters`}
      </span>
    </p>
  </div>
}

export type ChunkContainerProps = ChunkLabelProps & PropsWithChildren

export const ChunkContainer: FC<ChunkContainerProps> = (props) => {
  const { label, characterCount, children } = props
  return <div className='space-y-2'>
    <ChunkLabel label={label} characterCount={characterCount} />
    <div className='text-text-secondary body-md-regular'>
      {children}
    </div>
  </div>
}

export type QAPreviewProps = {
  qa: QA
}

export const QAPreview: FC<QAPreviewProps> = (props) => {
  const { qa } = props
  return <div className='flex flex-col gap-y-2'>
    <div className='flex gap-x-1'>
      <label className='text-text-tertiary shrink-0 text-[13px] font-medium leading-[20px]'>Q</label>
      <p className='text-text-secondary body-md-regular'>{qa.question}</p>
    </div>
    <div className='flex gap-x-1'>
      <label className='text-text-tertiary shrink-0 text-[13px] font-medium leading-[20px]'>A</label>
      <p className='text-text-secondary body-md-regular'>{qa.answer}</p>
    </div>
  </div>
}
