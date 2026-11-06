import type { ReactNode } from 'react'
import { useId } from 'react'
import { useDifyBuilderLocale } from '../i18n/use-builder-locale'

export const InteractionDockShell = ({
  children,
  description,
  footer,
  title,
}: {
  children?: ReactNode
  description?: string
  footer?: ReactNode
  title: string
}) => {
  const titleId = useId()
  const locale = useDifyBuilderLocale()

  return (
    <section
      aria-labelledby={titleId}
      lang={locale}
      className="mx-4 flex max-h-[min(60vh,26rem)] min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur wrap-anywhere shadow-lg backdrop-blur-[10px]"
    >
      <header className="shrink-0 px-4 pt-4 pb-3">
        <h2 id={titleId} className="system-sm-semibold text-text-primary">
          {title}
        </h2>
        {description && <p className="mt-1 system-xs-regular text-text-tertiary">{description}</p>}
      </header>
      {children ? (
        <div className="min-h-0 min-w-0 overflow-y-auto px-4 pb-3">{children}</div>
      ) : null}
      {footer ? <div className="flex shrink-0 justify-end px-4 py-4">{footer}</div> : null}
    </section>
  )
}
