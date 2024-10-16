import { useState } from 'react'
import { useChatWithHistoryContext } from './context'
import Sidebar from './sidebar'
import AppIcon from '@/app/components/base/app-icon'
import {
  Edit05,
  Menu01,
} from '@/app/components/base/icons/src/vender/line/general'

const HeaderInMobile = () => {
  const {
    appData,
    handleNewConversation,
  } = useChatWithHistoryContext()
  const [showSidebar, setShowSidebar] = useState(false)

  return (
    <>
      <div className='shrink-0 flex items-center px-3 h-[44px] border-b-[0.5px] border-b-gray-200'>
        <div
          className='shrink-0 flex items-center justify-center w-8 h-8 rounded-lg'
          onClick={() => setShowSidebar(true)}
        >
          <Menu01 className='w-4 h-4 text-gray-700' />
        </div>
        <div className='grow flex justify-center items-center px-3'>
          <AppIcon
            className='mr-2'
            size='tiny'
            icon={appData?.site.icon}
            iconType={appData?.site.icon_type}
            imageUrl={appData?.site.icon_url}
            background={appData?.site.icon_background}
          />
          <div className='py-1 text-base font-semibold text-gray-800 truncate'>
            {appData?.site.title}
          </div>
        </div>
        <div
          className='shrink-0 flex items-center justify-center w-8 h-8 rounded-lg'
          onClick={handleNewConversation}
        >
          <Edit05 className='w-4 h-4 text-gray-700' />
        </div>
      </div>
      {
        showSidebar && (
          <div className='fixed inset-0 z-50'
            style={{ backgroundColor: 'rgba(35, 56, 118, 0.2)' }}
            onClick={() => setShowSidebar(false)}
          >
            <div className='inline-block h-full bg-white' onClick={e => e.stopPropagation()}>
              <Sidebar />
            </div>
          </div>
        )
      }
    </>
  )
}

export default HeaderInMobile
