import { cn } from '@langgenius/dify-ui/cn'
import { FileTreeIcon } from '@langgenius/dify-ui/file-tree'
import { use } from 'react'
import { RosterReferenceBlockContext } from './context'
import {
  getRosterReferenceFileIconType,
  getRosterReferenceIconClassName,
  parseRosterReferenceToken,
} from './utils'

type RosterReferenceBlockComponentProps = {
  text: string
}

const RosterReferenceBlockComponent = ({
  text,
}: RosterReferenceBlockComponentProps) => {
  const rosterReferenceBlock = use(RosterReferenceBlockContext)
  const token = parseRosterReferenceToken(text)

  if (!token)
    return null

  const isKnowledge = token.kind === 'knowledge'
  const customIcon = rosterReferenceBlock?.renderIcon?.(token)
  const defaultIcon = token.kind === 'file'
    ? <FileTreeIcon type={getRosterReferenceFileIconType(token.label)} className="size-4" />
    : <span className={cn(isKnowledge ? 'size-3.5' : 'size-3.5 shrink-0', getRosterReferenceIconClassName(token))} />

  return (
    <span
      contentEditable={false}
      data-roster-reference-kind={token.kind}
      data-roster-reference-id={token.id}
      title={token.label}
      className="inline-flex min-w-[18px] items-center gap-0.5 overflow-hidden rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover py-px pr-1 pl-px align-middle shadow-xs shadow-shadow-shadow-3"
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[0.5px] border-divider-subtle bg-background-default-dodge',
          token.kind === 'cli_tool' && 'border-divider-regular bg-text-tertiary',
          isKnowledge && 'border-divider-subtle bg-util-colors-green-green-500 p-[3px] text-text-primary-on-surface shadow-xs shadow-shadow-shadow-3',
        )}
      >
        {customIcon || defaultIcon}
      </span>
      <span className="max-w-48 truncate system-xs-medium text-text-accent">
        {token.label}
      </span>
    </span>
  )
}

export default RosterReferenceBlockComponent
