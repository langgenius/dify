'use client'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
const Empty = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()

  return (
    <div className='flex flex-col items-center'>
      <div className="h-[149px] w-[163px] shrink-0 bg-[url('~@/app/components/tools/add-tool-modal/empty.png')] bg-cover bg-no-repeat"></div>
      <div className='text-text-primary mb-1 text-[13px] font-medium leading-[18px]'>
        {t(`tools.addToolModal.${searchParams.get('category') === 'workflow' ? 'emptyTitle' : 'emptyTitleCustom'}`)}
      </div>
      <div className='text-text-tertiary text-[13px] leading-[18px]'>
        {t(`tools.addToolModal.${searchParams.get('category') === 'workflow' ? 'emptyTip' : 'emptyTipCustom'}`)}
      </div>
    </div>
  )
}

export default Empty
