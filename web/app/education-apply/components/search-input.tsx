import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

const SearchInput = () => {
  const { t } = useTranslation()

  return (
    <PortalToFollowElem>
      <PortalToFollowElemTrigger className='block w-full'>
        <Input
          className='w-full'
          placeholder={t('education.form.schoolName.placeholder')}
        />
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-1 border-[0.5px] border-components-panel-border bg-components-panel-bg-blur rounded-xl'>
          <div
            className='flex items-center px-2 py-1.5 h-8 system-md-regular text-text-secondary truncate'
            title='Harvard University'
          >
            Harvard University
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default SearchInput
