import { cn } from '@langgenius/dify-ui/cn'
import {
  getRosterReferenceIconClassName,
  parseRosterReferenceToken,
} from './utils'

type RosterReferenceBlockComponentProps = {
  text: string
}

const RosterReferenceBlockComponent = ({
  text,
}: RosterReferenceBlockComponentProps) => {
  const token = parseRosterReferenceToken(text)

  if (!token)
    return null

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
        )}
      >
        <span className={cn('size-3.5 shrink-0', getRosterReferenceIconClassName(token))} />
      </span>
      <span className="max-w-48 truncate system-xs-medium text-text-accent">
        {token.label}
      </span>
    </span>
  )
}

export default RosterReferenceBlockComponent
