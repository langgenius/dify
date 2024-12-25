'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../base/app-icon'

const DatasetSvg = <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fillRule="evenodd" clipRule="evenodd" d="M0.833497 5.13481C0.833483 4.69553 0.83347 4.31654 0.858973 4.0044C0.88589 3.67495 0.94532 3.34727 1.10598 3.03195C1.34567 2.56155 1.72812 2.17909 2.19852 1.93941C2.51384 1.77875 2.84152 1.71932 3.17097 1.6924C3.48312 1.6669 3.86209 1.66691 4.30137 1.66693L7.62238 1.66684C8.11701 1.66618 8.55199 1.66561 8.95195 1.80356C9.30227 1.92439 9.62134 2.12159 9.88607 2.38088C10.1883 2.67692 10.3823 3.06624 10.603 3.50894L11.3484 5.00008H14.3679C15.0387 5.00007 15.5924 5.00006 16.0434 5.03691C16.5118 5.07518 16.9424 5.15732 17.3468 5.36339C17.974 5.68297 18.4839 6.19291 18.8035 6.82011C19.0096 7.22456 19.0917 7.65515 19.13 8.12356C19.1668 8.57455 19.1668 9.12818 19.1668 9.79898V13.5345C19.1668 14.2053 19.1668 14.7589 19.13 15.2099C19.0917 15.6784 19.0096 16.1089 18.8035 16.5134C18.4839 17.1406 17.974 17.6505 17.3468 17.9701C16.9424 18.1762 16.5118 18.2583 16.0434 18.2966C15.5924 18.3334 15.0387 18.3334 14.3679 18.3334H5.63243C4.96163 18.3334 4.40797 18.3334 3.95698 18.2966C3.48856 18.2583 3.05798 18.1762 2.65353 17.9701C2.02632 17.6505 1.51639 17.1406 1.19681 16.5134C0.990734 16.1089 0.908597 15.6784 0.870326 15.2099C0.833478 14.7589 0.833487 14.2053 0.833497 13.5345V5.13481ZM7.51874 3.33359C8.17742 3.33359 8.30798 3.34447 8.4085 3.37914C8.52527 3.41942 8.63163 3.48515 8.71987 3.57158C8.79584 3.64598 8.86396 3.7579 9.15852 4.34704L9.48505 5.00008L2.50023 5.00008C2.50059 4.61259 2.50314 4.34771 2.5201 4.14012C2.5386 3.91374 2.57 3.82981 2.59099 3.7886C2.67089 3.6318 2.79837 3.50432 2.95517 3.42442C2.99638 3.40343 3.08031 3.37203 3.30669 3.35353C3.54281 3.33424 3.85304 3.33359 4.3335 3.33359H7.51874Z" fill="#444CE7" />
</svg>

type Props = {
  isExternal?: boolean
  name: string
  description: string
  expand: boolean
  extraInfo?: React.ReactNode
}

const DatasetInfo: FC<Props> = ({
  name,
  description,
  isExternal,
  expand,
  extraInfo,
}) => {
  const { t } = useTranslation()
  return (
    <div className='pl-1 pt-1'>
      <div className='flex-shrink-0 mr-3'>
        <AppIcon innerIcon={DatasetSvg} className='!border-[0.5px] !border-indigo-100 !bg-indigo-25' />
      </div>
      {expand && (
        <div className='mt-2'>
          <div className='system-md-semibold text-text-secondary'>
            {name}
          </div>
          <div className='mt-1 text-text-tertiary system-2xs-medium-uppercase'>{isExternal ? t('dataset.externalTag') : t('dataset.localDocs')}</div>
          <div className='my-3  system-xs-regular text-text-tertiary first-letter:capitalize'>{description}</div>
        </div>
      )}
      {extraInfo}
    </div>
  )
}
export default React.memo(DatasetInfo)
