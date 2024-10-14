import { MarketplaceContextProvider } from './context'
import Description from './description'
import IntersectionLine from './intersection-line'
import SearchBox from './search-box'
import PluginTypeSwitch from './plugin-type-switch'
import List from './list'

const Marketplace = () => {
  return (
    <MarketplaceContextProvider>
      <Description />
      <IntersectionLine />
      <SearchBox />
      <PluginTypeSwitch />
      <List />
    </MarketplaceContextProvider>
  )
}

export default Marketplace
