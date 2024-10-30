'use client'
import { RiArrowRightUpLine } from '@remixicon/react'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import type { Plugin } from '@/app/components/plugins/types'
import Button from '@/app/components/base/button'

type CardWrapperProps = {
  plugin: Plugin
  showInstallButton?: boolean
}
const CardWrapper = ({
  plugin,
  showInstallButton,
}: CardWrapperProps) => {
  return (
    <div className='group relative rounded-xl cursor-pointer'>
      <Card
        key={plugin.name}
        payload={plugin}
        footer={
          <CardMoreInfo
            downloadCount={plugin.install_count}
            tags={['Search', 'Productivity']}
          />
        }
      />
      {
        showInstallButton && (
          <div className='hidden absolute bottom-0 group-hover:flex items-center space-x-2 px-4 pt-8 pb-4 w-full bg-gradient-to-tr from-[#f9fafb] to-[rgba(249,250,251,0)] rounded-b-xl'>
            <Button
              variant='primary'
              className='flex-1'
            >
              Install
            </Button>
            <Button
              className='flex-1'
            >
              Details
              <RiArrowRightUpLine className='ml-1 w-4 h-4' />
            </Button>
          </div>
        )
      }
    </div>
  )
}

export default CardWrapper
