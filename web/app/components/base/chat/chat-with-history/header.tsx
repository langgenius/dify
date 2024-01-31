import { useChatWithHistoryContext } from './context'

const Header = () => {
  const {
    appData,
  } = useChatWithHistoryContext()

  return (
    <div className='shrink-0 flex items-center px-8 h-16 text-base font-medium text-gray-900 border-b-[0.5px] border-b-gray-100'>
      {appData?.site.title}
    </div>
  )
}

export default Header
