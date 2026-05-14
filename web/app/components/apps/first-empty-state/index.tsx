'use client'

import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import LearnDify from '@/app/components/explore/learn-dify'
import FirstEmptyActionCard from './action-card'

type EmptyCreateAction = {
  id: string
  icon: string
  title: string
  description: string
  onClick: () => void
}

type Props = {
  onCreateBlank: () => void
  onCreateTemplate: () => void
  onImportDSL: () => void
}

const FirstEmptyState: FC<Props> = ({
  onCreateBlank,
  onCreateTemplate,
  onImportDSL,
}) => {
  const { t } = useTranslation()

  const actions: EmptyCreateAction[] = [
    {
      id: 'blank',
      icon: '🖌️',
      title: t('newApp.startFromBlank', { ns: 'app' }),
      description: t('firstEmpty.blankDescription', { ns: 'app' }),
      onClick: onCreateBlank,
    },
    {
      id: 'template',
      icon: '📑',
      title: t('newApp.startFromTemplate', { ns: 'app' }),
      description: t('firstEmpty.templateDescription', { ns: 'app' }),
      onClick: onCreateTemplate,
    },
    {
      id: 'dsl',
      icon: '📁',
      title: t('importDSL', { ns: 'app' }),
      description: t('firstEmpty.importDescription', { ns: 'app' }),
      onClick: onImportDSL,
    },
  ]

  return (
    <div className="flex grow flex-col px-6">
      <div className="flex flex-1 items-center justify-center py-10">
        <section className="mx-auto flex w-full max-w-[968px] flex-col items-center text-center">
          <h2 className="text-2xl/8 font-semibold text-text-primary">{t('firstEmpty.title', { ns: 'app' })}</h2>
          <p className="mt-2 max-w-[560px] system-sm-regular text-text-tertiary">
            {t('firstEmpty.description', { ns: 'app' })}
          </p>
          <div className="mt-6 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
            {actions.map(action => (
              <FirstEmptyActionCard
                key={action.id}
                description={action.description}
                icon={action.icon}
                onClick={action.onClick}
                title={action.title}
              />
            ))}
          </div>
          <div className="mt-6 flex items-center justify-center gap-2 text-text-quaternary">
            <span className="i-ri-drag-drop-line size-4" />
            <span className="system-xs-regular">{t('newApp.dropDSLToCreateApp', { ns: 'app' })}</span>
          </div>
        </section>
      </div>
      <div className="rounded-t-2xl rounded-b-none bg-background-section p-6 pb-8">
        <LearnDify
          className="px-0 pb-0"
          dismissible={false}
          itemLimit={3}
          showDescription={false}
          title={t('firstEmpty.learnDifyTitle', { ns: 'app' })}
        />
      </div>
    </div>
  )
}

export default FirstEmptyState
