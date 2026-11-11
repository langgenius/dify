import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'

function PanelLoading() {
  const { t } = useTranslation(['common'])

  return (
    <SkeletonContainer role="status" aria-label={t(($) => $.loading)} className="p-4">
      <SkeletonRectangle className="h-4 w-24" />
      <SkeletonRectangle className="h-20 w-full" />
      <SkeletonRectangle className="h-4 w-24" />
      <SkeletonRectangle className="h-20 w-full" />
    </SkeletonContainer>
  )
}

export default PanelLoading
