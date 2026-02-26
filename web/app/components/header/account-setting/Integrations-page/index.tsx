'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useAccountIntegrates } from '@/service/use-common'
import { cn } from '@/utils/classnames'
import s from './index.module.css'

const titleClassName = `
  mb-2 text-sm font-medium text-gray-900
`

export default function IntegrationsPage() {
  const { t } = useTranslation()

  const integrateMap = {
    google: {
      name: t('integrations.google', { ns: 'common' }),
      description: t('integrations.googleAccount', { ns: 'common' }),
    },
    github: {
      name: t('integrations.github', { ns: 'common' }),
      description: t('integrations.githubAccount', { ns: 'common' }),
    },
  }

  const { data } = useAccountIntegrates()
  const integrates = data?.data ?? []

  return (
    <>
      <div className="mb-8">
        <div className={titleClassName}>{t('integrations.connected', { ns: 'common' })}</div>
        {
          integrates.map((integrate) => {
            const info = integrateMap[integrate.provider]
            if (!info)
              return null
            return (
              <div key={integrate.provider} className="mb-2 flex items-center rounded-lg border-[0.5px] border-gray-200 bg-gray-50 px-3 py-2">
                <div className={cn('mr-3 h-8 w-8 rounded-lg border border-gray-100 bg-white', s[`${integrate.provider}-icon`])} />
                <div className="grow">
                  <div className="text-sm font-medium leading-[21px] text-gray-800">{info.name}</div>
                  <div className="text-xs font-normal leading-[18px] text-gray-500">{info.description}</div>
                </div>
                {
                  !integrate.is_bound && (
                    <Link
                      className="flex h-8 cursor-pointer items-center rounded-lg border border-gray-200 bg-white px-[7px] text-xs font-medium text-gray-700"
                      href={integrate.link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('integrations.connect', { ns: 'common' })}
                    </Link>
                  )
                }
              </div>
            )
          })
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
