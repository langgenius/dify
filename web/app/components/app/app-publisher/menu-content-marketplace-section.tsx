import type { FC } from 'react'
import type { AppPublisherMenuContentProps } from './menu-content.types'
import { useTranslation } from 'react-i18next'
import SuggestedAction from './suggested-action'

type MenuContentMarketplaceSectionProps = Pick<
  AppPublisherMenuContentProps,
  | 'onPublishToMarketplace'
  | 'publishingToMarketplace'
  | 'systemFeatures'
>

const MenuContentMarketplaceSection: FC<MenuContentMarketplaceSectionProps> = ({
  onPublishToMarketplace,
  publishingToMarketplace,
  systemFeatures,
}) => {
  const { t } = useTranslation()

  if (!systemFeatures.enable_creators_platform)
    return null

  return (
    <div className="flex flex-col gap-y-1 border-t-[0.5px] border-t-divider-regular p-4 pt-3">
      <SuggestedAction
        className="flex-1"
        disabled={publishingToMarketplace}
        icon={publishingToMarketplace
          ? <span className="i-ri-loader-2-line h-4 w-4 animate-spin" />
          : <span className="i-ri-store-2-line h-4 w-4" />}
        onClick={onPublishToMarketplace}
      >
        {publishingToMarketplace
          ? t('common.publishingToMarketplace', { ns: 'workflow' })
          : t('common.publishToMarketplace', { ns: 'workflow' })}
      </SuggestedAction>
    </div>
  )
}

export default MenuContentMarketplaceSection
