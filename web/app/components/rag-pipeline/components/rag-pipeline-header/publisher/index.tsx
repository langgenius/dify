import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Popup from './popup'

const Publisher = () => {
  const { t } = useTranslation()

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 40,
      }}
    >
      <PortalToFollowElemTrigger>
        <Button variant='primary'>
          {t('workflow.common.publish')}
          <RiArrowDownSLine className='h-4 w-4' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <Popup />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Publisher
