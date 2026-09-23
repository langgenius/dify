import { useTranslation } from 'react-i18next'

const Empty = () => {
  const { t } = useTranslation(['workflow'])

  return (
    <div className="flex h-10 items-center justify-center rounded-[10px] bg-background-section system-xs-regular text-text-tertiary">
      {t(($) => $['nodes.loop.setLoopVariables'], { ns: 'workflow' })}
    </div>
  )
}

export default Empty
