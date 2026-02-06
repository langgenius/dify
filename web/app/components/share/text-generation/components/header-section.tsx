import type { FC } from 'react'
import type { SavedMessage } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import { RiBookmark3Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import TabHeader from '@/app/components/base/tab-header'
import { appDefaultIconBackground } from '@/config'
import { AccessMode } from '@/models/access-control'
import { cn } from '@/utils/classnames'
import MenuDropdown from '../menu-dropdown'

type HeaderSectionProps = {
  isPC: boolean
  isInstalledApp: boolean
  isWorkflow: boolean
  siteInfo: SiteInfo
  accessMode: AccessMode
  savedMessages: SavedMessage[]
  currentTab: string
  onTabChange: (tab: string) => void
}

const HeaderSection: FC<HeaderSectionProps> = ({
  isPC,
  isInstalledApp,
  isWorkflow,
  siteInfo,
  accessMode,
  savedMessages,
  currentTab,
  onTabChange,
}) => {
  const { t } = useTranslation()

  const tabItems = [
    { id: 'create', name: t('generation.tabs.create', { ns: 'share' }) },
    { id: 'batch', name: t('generation.tabs.batch', { ns: 'share' }) },
    ...(!isWorkflow
      ? [{
          id: 'saved',
          name: t('generation.tabs.saved', { ns: 'share' }),
          isRight: true,
          icon: <RiBookmark3Line className="h-4 w-4" />,
          extra: savedMessages.length > 0
            ? <Badge className="ml-1">{savedMessages.length}</Badge>
            : null,
        }]
      : []),
  ]

  return (
    <div className={cn('shrink-0 space-y-4 border-b border-divider-subtle', isPC ? 'bg-components-panel-bg p-8 pb-0' : 'p-4 pb-0')}>
      <div className="flex items-center gap-3">
        <AppIcon
          size={isPC ? 'large' : 'small'}
          iconType={siteInfo.icon_type}
          icon={siteInfo.icon}
          background={siteInfo.icon_background || appDefaultIconBackground}
          imageUrl={siteInfo.icon_url}
        />
        <div className="system-md-semibold grow truncate text-text-secondary">{siteInfo.title}</div>
        <MenuDropdown hideLogout={isInstalledApp || accessMode === AccessMode.PUBLIC} data={siteInfo} />
      </div>
      {siteInfo.description && (
        <div className="system-xs-regular text-text-tertiary">{siteInfo.description}</div>
      )}
      <TabHeader
        items={tabItems}
        value={currentTab}
        onChange={onTabChange}
      />
    </div>
  )
}

export default HeaderSection
