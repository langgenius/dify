import Container from './Container'
import { useTranslation } from 'react-i18next'
import React, { useEffect } from 'react'

const AppList = async () => {
  return (
    <Container />
  )
}

useEffect(() => {
  document.title = `${t('dataset.title')} - Dify`
}, [])

export default AppList
function t(arg0: string) {
  throw new Error('Function not implemented.')
}

