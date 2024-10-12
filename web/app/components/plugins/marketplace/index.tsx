import Header from './header'
import HeaderWrapper from './header/wrapper'
import List from './list'
import ListWrapper from './list/wrapper'

const Marketplace = () => {
  return (
    <div className='grow relative flex flex-col w-full h-0'>
      <HeaderWrapper>
        <Header />
      </HeaderWrapper>
      <ListWrapper>
        <List />
      </ListWrapper>
    </div>
  )
}

export default Marketplace
