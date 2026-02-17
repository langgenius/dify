'use client'
import type { TocItem } from './hooks/use-doc-toc'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type TocPanelProps = {
  toc: TocItem[]
  activeSection: string
  isTocExpanded: boolean
  onToggle: (expanded: boolean) => void
  onItemClick: (e: React.MouseEvent<HTMLAnchorElement>, item: TocItem) => void
}

const TocPanel = ({ toc, activeSection, isTocExpanded, onToggle, onItemClick }: TocPanelProps) => {
  const { t } = useTranslation()

  if (!isTocExpanded) {
    return (
      <button
        type="button"
        onClick={() => onToggle(true)}
        className="group flex h-11 w-11 items-center justify-center rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg transition-all duration-150 hover:bg-background-default-hover hover:shadow-xl"
        aria-label="Open table of contents"
      >
        <span className="i-ri-list-unordered h-5 w-5 text-text-tertiary transition-colors group-hover:text-text-secondary" />
      </button>
    )
  }

  return (
    <nav className="toc flex max-h-[calc(100vh-150px)] w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-background-default-hover shadow-xl">
      <div className="relative z-10 flex items-center justify-between border-b border-components-panel-border-subtle bg-background-default-hover px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {t('develop.toc', { ns: 'appApi' })}
        </span>
        <button
          type="button"
          onClick={() => onToggle(false)}
          className="group flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-state-base-hover"
          aria-label="Close"
        >
          <span className="i-ri-close-line h-3 w-3 text-text-quaternary transition-colors group-hover:text-text-secondary" />
        </button>
      </div>

      <div className="from-components-panel-border-subtle/20 pointer-events-none absolute left-0 right-0 top-[41px] z-10 h-2 bg-gradient-to-b to-transparent"></div>
      <div className="pointer-events-none absolute left-0 right-0 top-[43px] z-10 h-3 bg-gradient-to-b from-background-default-hover to-transparent"></div>

      <div className="relative flex-1 overflow-y-auto px-3 py-3 pt-1">
        {toc.length === 0
          ? (
              <div className="px-2 py-8 text-center text-xs text-text-quaternary">
                {t('develop.noContent', { ns: 'appApi' })}
              </div>
            )
          : (
              <ul className="space-y-0.5">
                {toc.map((item) => {
                  const isActive = activeSection === item.href.replace('#', '')
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        onClick={e => onItemClick(e, item)}
                        className={cn(
                          'group relative flex items-center rounded-md px-3 py-2 text-[13px] transition-all duration-200',
                          isActive
                            ? 'bg-state-base-hover font-medium text-text-primary'
                            : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                        )}
                      >
                        <span
                          className={cn(
                            'mr-2 h-1.5 w-1.5 rounded-full transition-all duration-200',
                            isActive
                              ? 'scale-100 bg-text-accent'
                              : 'scale-75 bg-components-panel-border',
                          )}
                        />
                        <span className="flex-1 truncate">
                          {item.text}
                        </span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            )}
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-4 rounded-b-xl bg-gradient-to-t from-background-default-hover to-transparent"></div>
    </nav>
  )
}

export default TocPanel
