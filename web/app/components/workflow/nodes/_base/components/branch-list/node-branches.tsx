import type { TFunction } from 'i18next'
import type { FC } from 'react'
import type { Topic } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { NodeSourceHandle } from '../node-handle'
import ReadonlyInputWithSelectVar from '../readonly-input-with-select-var'
import { getDisplayClassLabel } from './class-label-utils'

const MAX_CLASS_TEXT_LENGTH = 50

type TruncatedClassItemProps = {
  topic: { id: string; name: string; label?: string | null }
  index: number
  nodeId: string
  t: TFunction
  defaultLabel?: string
}

const TruncatedClassItem: FC<TruncatedClassItemProps> = ({
  topic,
  index,
  nodeId,
  t,
  defaultLabel,
}) => {
  const displayLabel =
    topic.label?.trim() || defaultLabel || getDisplayClassLabel(topic.label, index + 1, t)
  const truncatedText =
    topic.name.length > MAX_CLASS_TEXT_LENGTH
      ? `${topic.name.slice(0, MAX_CLASS_TEXT_LENGTH)}...`
      : topic.name

  const shouldShowTooltip = topic.name.length > MAX_CLASS_TEXT_LENGTH

  const content = (
    <div className="truncate system-xs-regular text-text-tertiary">
      <ReadonlyInputWithSelectVar value={truncatedText} nodeId={nodeId} className="truncate" />
    </div>
  )

  return (
    <div className="flex flex-col gap-y-0.5 rounded-md bg-workflow-block-parma-bg px-1.25 py-0.75">
      <div className="text-xs/4 font-semibold text-text-secondary">{displayLabel}</div>
      {shouldShowTooltip ? (
        <Popover>
          <PopoverTrigger
            openOnHover
            aria-label={topic.name}
            className="w-full border-0 bg-transparent p-0 text-left"
          >
            {content}
          </PopoverTrigger>
          <PopoverContent className="max-w-75 px-3 py-2 system-xs-regular wrap-break-word text-text-tertiary">
            <ReadonlyInputWithSelectVar value={topic.name} nodeId={nodeId} />
          </PopoverContent>
        </Popover>
      ) : (
        content
      )}
    </div>
  )
}

export function NodeBranches({
  node,
  branches,
  defaultLabel,
}: {
  node: NodeProps
  branches: Topic[]
  defaultLabel?: (index: number) => string
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-2 space-y-0.5">
      {branches.map((topic, index) => (
        <div key={topic.id} className="relative">
          <TruncatedClassItem
            topic={topic}
            index={index}
            nodeId={node.id}
            t={t}
            defaultLabel={defaultLabel?.(index + 1)}
          />
          <NodeSourceHandle
            {...node}
            handleId={topic.id}
            handleClassName="top-1/2! -translate-y-1/2! -right-[21px]!"
          />
        </div>
      ))}
    </div>
  )
}
