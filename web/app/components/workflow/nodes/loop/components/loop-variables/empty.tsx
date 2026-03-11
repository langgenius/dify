import { useTranslation } from 'react-i18next'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className="flex h-10 items-center justify-center rounded-[10px] bg-background-section text-text-tertiary system-xs-regular">
      {t('nodes.loop.setLoopVariables', { ns: 'workflow' })}
    </div>
  )
}

export default Empty
