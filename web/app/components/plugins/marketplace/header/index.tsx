import Description from '../description'
import DescriptionWrapper from '../description/wrapper'
import SearchBoxWrapper from '../search-box/wrapper'
import PluginTypeSwitch from '../plugin-type-switch'

const Header = () => {
  return (
    <>
      <DescriptionWrapper>
        <Description />
      </DescriptionWrapper>
      <div className='flex items-center justify-center mt-[15px] mb-4'>
        <SearchBoxWrapper />
      </div>
      <PluginTypeSwitch />
    </>
  )
}

export default Header
