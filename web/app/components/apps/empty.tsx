import React from 'react'
import { useTranslation } from 'react-i18next'

const DefaultCards = React.memo(() => {
  const renderArray = Array.from({ length: 36 })
  return (
    <>
      {
        renderArray.map((_, index) => (
          <div
            key={index}
            className='inline-flex h-[160px] rounded-xl bg-background-default-lighter'
          />
        ))
      }
    </>
  )
})

const Empty = () => {
  const { t } = useTranslation()

  return (
    <>
      <DefaultCards />
      <div className='absolute bottom-0 left-0 right-0 top-0 flex items-center justify-center bg-gradient-to-t from-background-body to-transparent'>
        <span className='system-md-medium text-text-tertiary'>
          {t('app.newApp.noAppsFound')}
        </span>
      </div>
    </>
  )
}

export default React.memo(Empty)
