import { RiArrowUpDoubleLine } from '@remixicon/react'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { toolNotion } from '@/app/components/plugins/card/card-mock'
import { useGetLanguage } from '@/context/i18n'

type MarketplaceProps = {
  onMarketplaceScroll: () => void
}
const Marketplace = ({
  onMarketplaceScroll,
}: MarketplaceProps) => {
  const locale = useGetLanguage()

  return (
    <div className='shrink-0 sticky -bottom-[442px] h-[530px] overflow-y-auto px-12 py-2 pt-0 bg-background-default-subtle'>
      <RiArrowUpDoubleLine
        className='absolute top-2 left-1/2 -translate-x-1/2 w-4 h-4 text-text-quaternary cursor-pointer'
        onClick={() => onMarketplaceScroll()}
      />
      <div className='sticky top-0 pt-5 pb-3 bg-background-default-subtle z-10'>
        <div className='title-2xl-semi-bold bg-gradient-to-r from-[rgba(11,165,236,0.95)] to-[rgba(21,90,239,0.95)] bg-clip-text text-transparent'>More from Marketplace</div>
        <div className='flex items-center text-center body-md-regular text-text-tertiary'>
          Discover
          <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            models
          </span>
          ,
          <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            tools
          </span>
          ,
          <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            extensions
          </span>
          and
          <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            bundles
          </span>
          in Dify Marketplace
        </div>
      </div>
      <div className='py-3'>
        <div className='title-xl-semi-bold text-text-primary'>Featured</div>
        <div className='system-xs-regular text-text-tertiary'>Our top picks to get you started</div>
        <div className='grid grid-cols-4 gap-3 mt-2'>
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
        </div>
      </div>
      <div className='py-3'>
        <div className='title-xl-semi-bold text-text-primary'>Popular</div>
        <div className='system-xs-regular text-text-tertiary'>Explore the library and discover the incredible work of our community</div>
        <div className='grid grid-cols-4 gap-3 mt-2'>
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
        </div>
      </div>
    </div>
  )
}

export default Marketplace
