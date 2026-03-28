import { useTranslation } from 'react-i18next'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className="system-xs-regular flex h-10 items-center justify-center rounded-[10px] bg-background-section text-text-tertiary">
      {t('nodes.loop.setLoopVariables', { ns: 'workflow' })}
    </div>
  )
}

export default Empty
