'use client'

import type { SnippetSection } from '@/models/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import NavLink from '@/app/components/app-sidebar/nav-link'
import { SnippetPlaceholderIcon } from './snippet-placeholder-icon'

export function SnippetCollapsedPreview({
  inputFieldCount,
  snippetId,
  section,
  isPublished,
  evaluationEnabled,
}: {
  inputFieldCount: number
  snippetId?: string
  section: SnippetSection
  isPublished?: boolean
  evaluationEnabled: boolean
}) {
  const { t } = useTranslation(['evaluation', 'snippet'])
  const orchestrateLabel = t(($) => $.sectionOrchestrate, { ns: 'snippet' })
  const evaluationLabel = t(($) => $.title, { ns: 'evaluation' })

  return (
    <div className="flex min-h-0 grow flex-col items-center px-2">
      <div className="mb-3.5 flex w-full shrink-0 justify-center px-3.5 pt-0.5 pb-0.75">
        <div className="my-0 h-px w-6.75 shrink-0 bg-divider-subtle" data-testid="divider"></div>
      </div>
      <SnippetPlaceholderIcon className="size-9" />
      <div className="my-4 h-px w-8 rounded-full bg-divider-subtle" aria-hidden="true" />
      {snippetId ? (
        <nav className="flex flex-col gap-y-0.5">
          <NavLink
            mode="collapse"
            name={orchestrateLabel}
            href={`/snippets/${snippetId}/orchestrate`}
            active={section === 'orchestrate'}
            iconMap={{ selected: 'i-ri-node-tree', normal: 'i-ri-node-tree' }}
          />
          {evaluationEnabled && (
            <NavLink
              mode="collapse"
              name={evaluationLabel}
              href={`/snippets/${snippetId}/evaluation`}
              active={section === 'evaluation'}
              disabled={!isPublished}
              iconMap={{ selected: 'i-ri-flask-fill', normal: 'i-ri-flask-line' }}
            />
          )}
        </nav>
      ) : (
        <div className="flex size-8 items-center justify-center rounded-lg border-t-[0.75px] border-r-[0.25px] border-b-[0.25px] border-l-[0.75px] border-effects-highlight-lightmode-off bg-components-menu-item-bg-active p-1.5 text-text-accent-light-mode-only">
          <div className="flex size-5 items-center justify-center">
            <span
              aria-hidden
              className={cn(
                section === 'evaluation' ? 'i-ri-flask-fill' : 'i-ri-node-tree',
                'size-4.5 shrink-0',
              )}
            />
          </div>
          <span className="sr-only">
            {section === 'evaluation' ? evaluationLabel : orchestrateLabel}
          </span>
        </div>
      )}
      {section === 'orchestrate' && (
        <div
          className={cn(
            'mt-4 flex min-w-6 items-center justify-center rounded-full border border-divider-subtle bg-components-badge-bg-gray-soft px-2 text-2xs leading-4 font-normal text-text-secondary',
            inputFieldCount > 99 ? 'h-5' : 'size-5',
          )}
        >
          {inputFieldCount}
          <span className="sr-only"> {t(($) => $.inputVariables, { ns: 'snippet' })}</span>
        </div>
      )}
    </div>
  )
}
