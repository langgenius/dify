import { MarketplaceContextProvider } from './context'
import HeaderWrapper from './header-wrapper'
import Header from './header'
import ListWrapper from './list-wrapper'
import List from './list'

const Marketplace = () => {
  return (
    <div className='w-full'>
      <MarketplaceContextProvider>
        <HeaderWrapper>
          <Header />
        </HeaderWrapper>
        <ListWrapper>
          <List />
        </ListWrapper>
      </MarketplaceContextProvider>
    </div>
  )
}

export default Marketplace
