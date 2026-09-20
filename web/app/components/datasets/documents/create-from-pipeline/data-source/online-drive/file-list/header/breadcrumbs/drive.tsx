import { useTranslation } from 'react-i18next'
import BreadcrumbItem from './item'

type DriveProps = {
  breadcrumbs: string[]
  handleBackToRoot: () => void
}

export default function Drive({ breadcrumbs, handleBackToRoot }: DriveProps) {
  const { t } = useTranslation()

  return (
    <BreadcrumbItem
      name={t(($) => $['onlineDrive.breadcrumbs.allFiles'], { ns: 'datasetPipeline' })}
      current={breadcrumbs.length === 0}
      onClick={handleBackToRoot}
    />
  )
}
