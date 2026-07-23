import AccountDropdown from '@/app/components/header/account-dropdown'
import Marketplace from '@/app/components/plugins/marketplace'
import PluginPage from '@/app/components/plugins/plugin-page'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'

const PluginList = () => {
  return (
    <PluginPage
      plugins={<PluginsPanel />}
      marketplace={(
        <Marketplace
          variant="home"
          homeHeaderActions={(
            <div className="p-0.5">
              <AccountDropdown />
            </div>
          )}
        />
      )}
    />
  )
}

export default PluginList
