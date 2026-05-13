import { RiPuzzle2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className="mb-2 rounded-xl bg-background-section p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg-alt shadow-lg backdrop-blur-xs">
        <RiPuzzle2Line className="h-5 w-5 text-text-accent" />
      </div>
      <div className="mb-1 system-sm-medium text-text-secondary">{t('apiBasedExtension.title', { ns: 'common' })}</div>
    </div>
  )
}

export default Empty
