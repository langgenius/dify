import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { useDocLink } from '@/context/i18n'

const Empty: FC = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl bg-background-section p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
        <Variable02 className="h-5 w-5 text-text-accent" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-text-secondary system-sm-semibold">{t('debug.variableInspect.title', { ns: 'workflow' })}</div>
        <div className="text-text-tertiary system-xs-regular">{t('debug.variableInspect.emptyTip', { ns: 'workflow' })}</div>
        <a
          className="cursor-pointer text-text-accent system-xs-regular"
          href={docLink('/use-dify/debug/variable-inspect')}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('debug.variableInspect.emptyLink', { ns: 'workflow' })}
        </a>
      </div>
    </div>
  )
}

export default Empty
