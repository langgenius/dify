'use client'
import { RiArrowRightUpLine } from '@remixicon/react'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import type { Plugin } from '@/app/components/plugins/types'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import Button from '@/app/components/base/button'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useBoolean } from 'ahooks'

type CardWrapperProps = {
  plugin: Plugin
  showInstallButton?: boolean
  locale?: string
}
const CardWrapper = ({
  plugin,
  showInstallButton,
  locale,
}: CardWrapperProps) => {
  const { t } = useMixedTranslation(locale)
  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)

  if (showInstallButton) {
    return (
      <div
        className='group relative rounded-xl cursor-pointer'
      >
        <Card
          key={plugin.name}
          payload={plugin}
          locale={locale}
          footer={
            <CardMoreInfo
              downloadCount={plugin.install_count}
              tags={plugin.tags.map(tag => tag.name)}
            />
          }
        />
        {
          showInstallButton && (
            <div className='hidden absolute bottom-0 group-hover:flex items-center space-x-2 px-4 pt-8 pb-4 w-full bg-gradient-to-tr from-[#f9fafb] to-[rgba(249,250,251,0)] rounded-b-xl'>
              <Button
                variant='primary'
                className='flex-1'
                onClick={showInstallFromMarketplace}
              >
                {t('plugin.detailPanel.operation.install')}
              </Button>
              <Button
                className='flex-1'
              >
                <a href={`${MARKETPLACE_URL_PREFIX}/plugin/${plugin.org}/${plugin.name}`} target='_blank' className='flex items-center gap-0.5'>
                  {t('plugin.detailPanel.operation.detail')}
                  <RiArrowRightUpLine className='ml-1 w-4 h-4' />
                </a>
              </Button>
            </div>
          )
        }
        {
          isShowInstallFromMarketplace && (
            <InstallFromMarketplace
              manifest={plugin as any}
              uniqueIdentifier={plugin.latest_package_identifier}
              onClose={hideInstallFromMarketplace}
              onSuccess={hideInstallFromMarketplace}
            />
          )
        }
      </div>
    )
  }

  return (
    <a
      className='group inline-block relative rounded-xl cursor-pointer'
      href={`${MARKETPLACE_URL_PREFIX}/plugin/${plugin.org}/${plugin.name}`}
    >
      <Card
        key={plugin.name}
        payload={plugin}
        locale={locale}
        footer={
          <CardMoreInfo
            downloadCount={plugin.install_count}
            tags={plugin.tags.map(tag => tag.name)}
          />
        }
      />
      {
        showInstallButton && (
          <div className='hidden absolute bottom-0 group-hover:flex items-center space-x-2 px-4 pt-8 pb-4 w-full bg-gradient-to-tr from-[#f9fafb] to-[rgba(249,250,251,0)] rounded-b-xl'>
            <Button
              variant='primary'
              className='flex-1'
              onClick={showInstallFromMarketplace}
            >
              {t('plugin.detailPanel.operation.install')}
            </Button>
            <Button
              className='flex-1'
            >
              <a href={`${MARKETPLACE_URL_PREFIX}/plugin/${plugin.org}/${plugin.name}`} target='_blank' className='flex items-center gap-0.5'>
                {t('plugin.detailPanel.operation.detail')}
                <RiArrowRightUpLine className='ml-1 w-4 h-4' />
              </a>
            </Button>
          </div>
        )
      }
    </a>
  )
}

export default CardWrapper
