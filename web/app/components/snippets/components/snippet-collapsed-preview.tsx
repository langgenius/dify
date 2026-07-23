'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import NavLink from '@/app/components/app-sidebar/nav-link'
import { SnippetPlaceholderIcon } from './snippet-placeholder-icon'

const NodeTreeIcon = ({ className }: { className?: string }) => (
  <span className={cn('i-ri-node-tree', className)} />
)

export function SnippetCollapsedPreview({
  inputFieldCount,
  snippetId,
}: {
  inputFieldCount: number
  snippetId?: string
}) {
  const { t } = useTranslation()
  const sectionLabel = t(($) => $.sectionOrchestrate, { ns: 'snippet' })

  return (
    <div
      className="flex min-h-0 grow flex-col items-center px-2"
      aria-label="Snippet collapsed preview"
    >
      <div className="mb-3.5 flex w-full shrink-0 justify-center px-3.5 pt-0.5 pb-0.75">
        <div className="my-0 h-px w-6.75 shrink-0 bg-divider-subtle" data-testid="divider"></div>
      </div>
      <SnippetPlaceholderIcon className="size-9" />
      <div className="my-4 h-px w-8 rounded-full bg-divider-subtle" aria-hidden="true" />
      {snippetId ? (
        <NavLink
          mode="collapse"
          name={sectionLabel}
          href={`/snippets/${snippetId}/orchestrate`}
          active
          iconMap={{ selected: NodeTreeIcon, normal: NodeTreeIcon }}
        />
      ) : (
        <div
          aria-label={sectionLabel}
          className="flex size-8 items-center justify-center rounded-lg border-t-[0.75px] border-r-[0.25px] border-b-[0.25px] border-l-[0.75px] border-effects-highlight-lightmode-off bg-components-menu-item-bg-active p-1.5 text-text-accent-light-mode-only"
        >
          <div className="flex size-5 items-center justify-center">
            <NodeTreeIcon className="size-4.5 shrink-0" />
          </div>
        </div>
      )}
      <div
        className={cn(
          'mt-4 flex min-w-6 items-center justify-center rounded-full border border-divider-subtle bg-components-badge-bg-gray-soft px-2 text-2xs leading-4 font-normal text-text-secondary',
          inputFieldCount > 99 ? 'h-5' : 'size-5',
        )}
        aria-label={`${inputFieldCount} ${t(($) => $.inputVariables, { ns: 'snippet' })}`}
      >
        {inputFieldCount}
      </div>
    </div>
  )
}
