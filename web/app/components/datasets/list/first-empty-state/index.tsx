import { Trans, useTranslation } from 'react-i18next'
import FirstEmptyActionCard from '@/app/components/apps/first-empty-state/action-card'

type EmptyCreateAction = {
  badge: string
  badgeVariant: 'basic' | 'advanced'
  id: string
  href: string
  icon: string
  title: string
  description: string
}

const DatasetFirstEmptyState = () => {
  const { t } = useTranslation()

  const actions: EmptyCreateAction[] = [
    {
      badge: t('firstEmpty.basicBadge', { ns: 'dataset' }),
      badgeVariant: 'basic',
      id: 'create',
      href: '/datasets/create',
      icon: '📚',
      title: t('createDataset', { ns: 'dataset' }),
      description: t('firstEmpty.createDescription', { ns: 'dataset' }),
    },
    {
      badge: t('firstEmpty.advancedBadge', { ns: 'dataset' }),
      badgeVariant: 'advanced',
      id: 'pipeline',
      href: '/datasets/create-from-pipeline',
      icon: '🧭',
      title: t('createFromPipeline', { ns: 'dataset' }),
      description: t('firstEmpty.pipelineDescription', { ns: 'dataset' }),
    },
    {
      badge: t('firstEmpty.advancedBadge', { ns: 'dataset' }),
      badgeVariant: 'advanced',
      id: 'connect',
      href: '/datasets/connect',
      icon: '🎓',
      title: t('connectDataset', { ns: 'dataset' }),
      description: t('firstEmpty.connectDescription', { ns: 'dataset' }),
    },
  ]

  return (
    <div className="flex grow flex-col px-6">
      <div className="flex flex-1 items-center justify-center py-10">
        <section className="mx-auto flex w-full max-w-[933px] flex-col items-center gap-6 text-center">
          <div className="flex w-full max-w-[739px] flex-col items-center gap-2">
            <h2 className="text-xl/6 font-semibold text-text-primary">{t('firstEmpty.title', { ns: 'dataset' })}</h2>
            <p className="w-full truncate system-sm-regular text-text-tertiary">
              {t('firstEmpty.description', { ns: 'dataset' })}
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-3">
            {actions.map(({ badge, badgeVariant, id, href, icon, title, description }) => (
              <FirstEmptyActionCard
                key={id}
                badge={badge}
                badgeVariant={badgeVariant}
                description={description}
                href={href}
                icon={icon}
                title={title}
                visualStyle="compact"
              />
            ))}
          </div>
          <p className="max-w-full rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px] text-center system-2xs-medium-uppercase text-text-tertiary">
            <Trans
              i18nKey="firstEmpty.pickHint"
              ns="dataset"
              components={{
                highlight: <span className="text-text-tertiary" />,
              }}
            />
          </p>
        </section>
      </div>
    </div>
  )
}

export default DatasetFirstEmptyState
