import type { ReactNode } from 'react'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useDifyBuilderLocale } from '../i18n/use-builder-locale'

export const InteractionDockShell = ({
  children,
  description,
  footer,
  title,
}: {
  children?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  title: string
}) => {
  const titleId = useId()
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['common'], { lng: locale })

  return (
    <section
      aria-labelledby={titleId}
      lang={locale}
      className="mx-4 flex max-h-(--dock-max-height) min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur wrap-anywhere shadow-lg backdrop-blur-[10px] [--dock-max-height:min(60dvh,26rem)]"
    >
      <header className="shrink-0 px-4 pt-4 pb-2">
        <h2 id={titleId} className="system-sm-semibold text-text-primary">
          {title}
        </h2>
      </header>
      {description && (
        <ScrollArea className="relative mx-4 mb-2 shrink-0 rounded-sm">
          <ScrollAreaViewport
            role="region"
            aria-label={t(($) => $['operation.viewDetails'], { ns: 'common' })}
            className="max-h-[clamp(2rem,calc(var(--dock-max-height)-16rem),9rem)] overscroll-contain"
            style={{ overflowX: 'hidden' }}
          >
            <ScrollAreaContent className="pe-3" style={{ minWidth: 0 }}>
              {typeof description === 'string' ? (
                <p className="system-xs-regular whitespace-pre-wrap text-text-secondary">
                  {description}
                </p>
              ) : (
                description
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      )}
      {children ? (
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 pb-3">
          {children}
        </div>
      ) : null}
      {footer ? <div className="flex shrink-0 justify-end px-4 py-3">{footer}</div> : null}
    </section>
  )
}
