import type { FC, PropsWithChildren } from 'react'
import type { QA } from '@/models/datasets'
import { SelectionMod } from '../base/icons/src/public/knowledge'

export type ChunkLabelProps = {
  label: string
  characterCount: number
}

export const ChunkLabel: FC<ChunkLabelProps> = (props) => {
  const { label, characterCount } = props
  return (
    <div className="flex items-center text-xs font-medium text-text-tertiary">
      <SelectionMod className="size-[10px]" />
      <p className="ml-0.5 flex gap-2">
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
  )
}

export type ChunkContainerProps = ChunkLabelProps & PropsWithChildren

export const ChunkContainer: FC<ChunkContainerProps> = (props) => {
  const { label, characterCount, children } = props
  return (
    <div className="space-y-2">
      <ChunkLabel label={label} characterCount={characterCount} />
      <div className="body-md-regular text-text-secondary">
        {children}
      </div>
    </div>
  )
}

export type QAPreviewProps = {
  qa: QA
}

export const QAPreview: FC<QAPreviewProps> = (props) => {
  const { qa } = props
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex gap-x-1">
        <label className="shrink-0 text-[13px] font-medium leading-[20px] text-text-tertiary">Q</label>
        <p className="body-md-regular text-text-secondary">{qa.question}</p>
      </div>
      <div className="flex gap-x-1">
        <label className="shrink-0 text-[13px] font-medium leading-[20px] text-text-tertiary">A</label>
        <p className="body-md-regular text-text-secondary">{qa.answer}</p>
      </div>
    </div>
  )
}
