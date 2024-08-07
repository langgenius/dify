import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import Button from '@/app/components/base/button'
import { Grid01 } from '@/app/components/base/icons/src/vender/solid/layout'
import { Container, Database01 } from '@/app/components/base/icons/src/vender/line/development'
import { ImagePlus } from '@/app/components/base/icons/src/vender/line/images'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'

const CustomAppHeaderBrand = () => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()

  return (
    <div className='py-3'>
      <div className='mb-2 text-sm font-medium text-gray-900'>{t('custom.app.title')}</div>
      <div className='relative mb-4 rounded-xl bg-gray-100 border-[0.5px] border-black/8 shadow-xs'>
        <div className={`${s.mask} absolute inset-0 rounded-xl`}></div>
        <div className='flex items-center pl-5 h-14 rounded-t-xl'>
          <div className='relative flex items-center mr-[199px] w-[120px] h-10 bg-[rgba(217,45,32,0.12)]'>
            <div className='ml-[1px] mr-[3px] w-[34px] h-[34px] border-8 border-black/[0.16] rounded-full'></div>
            <div className='text-[13px] font-bold text-black/[0.24]'>YOUR LOGO</div>
            <div className='absolute top-0 bottom-0 left-0.5 w-[0.5px] bg-[#F97066] opacity-50'></div>
            <div className='absolute top-0 bottom-0 right-0.5 w-[0.5px] bg-[#F97066] opacity-50'></div>
            <div className='absolute left-0 right-0 top-0.5 h-[0.5px] bg-[#F97066] opacity-50'></div>
            <div className='absolute left-0 right-0 bottom-0.5 h-[0.5px] bg-[#F97066] opacity-50'></div>
          </div>
          <div className='flex items-center mr-3 px-3 h-7 rounded-xl bg-white shadow-xs'>
            <Grid01 className='shrink-0 mr-2 w-4 h-4 text-[#155eef]' />
            <div className='w-12 h-1.5 rounded-[5px] bg-[#155eef] opacity-80'></div>
          </div>
          <div className='flex items-center mr-3 px-3 h-7'>
            <Container className='shrink-0 mr-2 w-4 h-4 text-gray-500' />
            <div className='w-[50px] h-1.5 rounded-[5px] bg-gray-300'></div>
          </div>
          <div className='flex items-center px-3 h-7'>
            <Database01 className='shrink-0 mr-2 w-4 h-4 text-gray-500' />
            <div className='w-14 h-1.5 rounded-[5px] bg-gray-300 opacity-80'></div>
          </div>
        </div>
        <div className='h-8 border-t border-t-gray-200 rounded-b-xl'></div>
      </div>
      <div className='flex items-center mb-2'>
        <Button
          disabled={plan.type === Plan.sandbox}
        >
          <ImagePlus className='mr-2 w-4 h-4' />
          {t('custom.upload')}
        </Button>
        <div className='mx-2 h-5 w-[1px] bg-black/5'></div>
        <Button
          disabled={plan.type === Plan.sandbox}
        >
          {t('custom.restore')}
        </Button>
      </div>
      <div className='text-xs text-gray-500'>{t('custom.app.changeLogoTip')}</div>
    </div>
  )
}

export default CustomAppHeaderBrand
