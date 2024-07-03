import {
  memo,
} from 'react'
import cn from 'classnames'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

export type ChatWrapperRefType = {
  handleRestart: () => void
}
const EnvPanel = () => {
  const { t } = useTranslation()
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)

  return (
    <div
      className={cn(
        'flex flex-col w-[400px] bg-white rounded-l-2xl h-full border border-black/2',
      )}
    >
      <div className='shrink-0 flex items-center justify-between pl-4 pr-3 pt-3 pb-2 font-semibold text-gray-900'>
        {t('workflow.env.envPanelTitle')}
        <div className='flex items-center'>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={() => setShowEnvPanel(false)}
          >
            <RiCloseLine className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
      <div className='grow rounded-b-2xl overflow-y-auto'>
      </div>
    </div>
  )
}

export default memo(EnvPanel)
