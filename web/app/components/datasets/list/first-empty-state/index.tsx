import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import FirstEmptyActionCard from '@/app/components/apps/first-empty-state/action-card'

const EMPTY_PLACEHOLDER_CARD_IDS = Array.from({ length: 16 }, (_, index) => `dataset-placeholder-card-${index}`)

type EmptyCreateAction = {
  badge?: string
  href: string
  icon: ReactNode
  id: string
  title: string
  description: string
}

type DatasetFirstEmptyStateProps = {
  canConnectExternalDataset: boolean
  canCreateDataset: boolean
}

function DatasetFirstEmptyState({
  canConnectExternalDataset,
  canCreateDataset,
}: DatasetFirstEmptyStateProps) {
  const { t } = useTranslation()

  const createActions: EmptyCreateAction[] = canCreateDataset
    ? [
        {
          badge: t($ => $['firstEmpty.recommended'], { ns: 'dataset' }),
          href: '/datasets/create',
          icon: <span aria-hidden className="i-ri-add-line size-4" />,
          id: 'create',
          title: t($ => $['firstEmpty.createTitle'], { ns: 'dataset' }),
          description: t($ => $['firstEmpty.createDescription'], { ns: 'dataset' }),
        },
        {
          href: '/datasets/create-from-pipeline',
          icon: <span aria-hidden className="i-custom-vender-pipeline-pipeline-line size-4" />,
          id: 'pipeline',
          title: t($ => $['firstEmpty.pipelineTitle'], { ns: 'dataset' }),
          description: t($ => $['firstEmpty.pipelineDescription'], { ns: 'dataset' }),
        },
      ]
    : []
  const connectAction: EmptyCreateAction | undefined = canConnectExternalDataset
    ? {
        href: '/datasets/connect',
        icon: <span aria-hidden className="i-custom-vender-solid-development-api-connection-mod size-4" />,
        id: 'connect',
        title: t($ => $.connectDataset, { ns: 'dataset' }),
        description: t($ => $['firstEmpty.connectDescription'], { ns: 'dataset' }),
      }
    : undefined
  const hasActions = createActions.length > 0 || !!connectAction

  if (!hasActions)
    return null

  return (
    <div className="flex grow flex-col overflow-hidden">
      <div className="relative min-h-[520px] flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-8 inset-y-2 grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] grid-rows-4 gap-3">
          {EMPTY_PLACEHOLDER_CARD_IDS.map(id => (
            <div key={id} className="rounded-xl bg-background-default-lighter opacity-75" />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-body/0 to-background-body" />
        <section className="absolute inset-0 flex items-center justify-center overflow-hidden p-2" aria-labelledby="datasets-first-empty-title">
          <div className="flex w-full max-w-[520px] flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md">
                <div className="flex size-full min-w-px items-center justify-center">
                  <span aria-hidden className="i-ri-book-2-line size-6 text-text-tertiary" />
                </div>
              </div>
              <h2 id="datasets-first-empty-title" className="system-sm-regular text-text-tertiary">
                {t($ => $['firstEmpty.title'], { ns: 'dataset' })}
              </h2>
            </div>
            <div className="flex w-full flex-col gap-2 pb-8">
              {createActions.length > 0 && (
                <div className="flex flex-col gap-2">
                  {createActions.map(action => (
                    <FirstEmptyActionCard
                      key={action.id}
                      badge={action.badge}
                      description={action.description}
                      href={action.href}
                      icon={action.icon}
                      title={action.title}
                      visualStyle="list"
                    />
                  ))}
                </div>
              )}
              {createActions.length > 0 && connectAction && (
                <div className="flex items-center gap-2 text-text-tertiary">
                  <div className="h-px min-w-0 flex-1 bg-linear-to-r from-background-body/0 to-divider-regular" />
                  <span className="system-xs-medium-uppercase uppercase">{t($ => $['firstEmpty.or'], { ns: 'dataset' })}</span>
                  <div className="h-px min-w-0 flex-1 bg-linear-to-r from-divider-regular to-background-body/0" />
                </div>
              )}
              {connectAction && (
                <FirstEmptyActionCard
                  description={connectAction.description}
                  href={connectAction.href}
                  icon={connectAction.icon}
                  title={connectAction.title}
                  visualStyle="list"
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default DatasetFirstEmptyState
