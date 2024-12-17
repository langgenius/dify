import { useTranslation } from 'react-i18next'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col items-center'>
      <div className="shrink-0 w-[163px] h-[149px] bg-cover bg-no-repeat bg-[url('~@/app/components/tools/add-tool-modal/empty.png')]"></div>
      <div className='mb-1 text-[13px] font-medium text-text-primary leading-[18px]'>{t('tools.addToolModal.emptyTitle')}</div>
      <div className='text-[13px] text-text-tertiary leading-[18px]'>{t('tools.addToolModal.emptyTip')}</div>
    </div>
  )
}

export default Empty
