import { useTranslation } from 'react-i18next'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className='system-xs-regular flex h-10 items-center justify-center rounded-[10px] bg-background-section text-text-tertiary'>
      {t('workflow.nodes.loop.setLoopVariables')}
    </div>
  )
}

export default Empty
