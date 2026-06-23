'use client'

import type { ReactNode } from 'react'
import { useTranslation } from '#i18n'
import { MainNav } from '.'
import { MAIN_CONTENT_ID, SkipNav } from './skip-nav'

type MainNavLayoutProps = {
  children: ReactNode
}

const MainNavLayout = ({
  children,
}: MainNavLayoutProps) => {
  const { t } = useTranslation('common')

  return (
    <div className="flex h-0 min-h-0 grow overflow-hidden bg-background-body">
      <SkipNav>{t('navigation.skipToMain')}</SkipNav>
      <MainNav />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex min-w-0 grow flex-col overflow-hidden outline-hidden focus:outline-hidden focus-visible:outline-hidden"
      >
        {children}
      </main>
    </div>
  )
}

export default MainNavLayout
