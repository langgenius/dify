import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { toolNotion } from '@/app/components/plugins/card/card-mock'
import { getLocaleOnServer } from '@/i18n/server'

const List = () => {
  const locale = getLocaleOnServer()

  return (
    <>
      <div className='py-3'>
        <div className='title-xl-semi-bold text-text-primary'>Featured</div>
        <div className='system-xs-regular text-text-tertiary'>Our top picks to get you started</div>
        <div className='grid grid-cols-4 gap-3 mt-2'>
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
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
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
          <Card
            locale={locale}
            payload={toolNotion as any}
            footer={
              <CardMoreInfo downloadCount={1234} tags={['Search', 'Productivity']} />
            }
          />
        </div>
      </div>
    </>
  )
}

export default List
