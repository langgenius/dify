'use client'

import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import Link from 'next/link'
import s from './index.module.css'
import classNames from '@/utils/classnames'
import { fetchAccountIntegrates } from '@/service/common'

const titleClassName = `
  mb-2 text-sm font-medium text-gray-900
`

export default function IntegrationsPage() {
  const { t } = useTranslation()

  const integrateMap = {
    google: {
      name: t('common.integrations.google'),
      description: t('common.integrations.googleAccount'),
    },
    github: {
      name: t('common.integrations.github'),
      description: t('common.integrations.githubAccount'),
    },
  }

  const { data } = useSWR({ url: '/account/integrates' }, fetchAccountIntegrates)
  const integrates = data?.data?.length ? data.data : []

  return (
    <>
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.integrations.connected')}</div>
        {
          integrates.map(integrate => (
            <div key={integrate.provider} className='mb-2 flex items-center px-3 py-2 bg-gray-50 border-[0.5px] border-gray-200 rounded-lg'>
              <div className={classNames('w-8 h-8 mr-3 bg-white rounded-lg border border-gray-100', s[`${integrate.provider}-icon`])} />
              <div className='grow'>
                <div className='leading-[21px] text-sm font-medium text-gray-800'>{integrateMap[integrate.provider].name}</div>
                <div className='leading-[18px] text-xs font-normal text-gray-500'>{integrateMap[integrate.provider].description}</div>
              </div>
              {
                !integrate.is_bound && (
                  <Link
                    className='flex items-center h-8 px-[7px] bg-white rounded-lg border border-gray-200 text-xs font-medium text-gray-700 cursor-pointer'
                    href={integrate.link}
                    target='_blank' rel='noopener noreferrer'>
                    {t('common.integrations.connect')}
                  </Link>
                )
              }
            </div>
          ))
        }
      </div>
      {/* <div className='mb-8'>
        <div className={titleClassName}>Add a service </div>
        {
          services.map(service => (
            <div key={service.key} className='mb-2 flex items-center px-3 py-2 bg-gray-50 border-[0.5px] border-gray-200 rounded-lg'>
              <div className={classNames('w-8 h-8 mr-3 bg-white rounded-lg border border-gray-100', s[`${service.key}-icon`])} />
              <div className='grow'>
                <div className='leading-[21px] text-sm font-medium text-gray-800'>{service.name}</div>
                <div className='leading-[18px] text-xs font-normal text-gray-500'>{service.description}</div>
              </div>
              <Button className='text-xs font-medium text-gray-800'>Connect</Button>
            </div>
          ))
        }
      </div> */}
    </>
  )
}
