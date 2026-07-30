import { Suspense } from 'react'
import AppList from '@/app/components/explore/app-list'
import { HomeBanner } from '@/app/components/explore/banner/home-banner'
import { BannerSkeleton } from '@/app/components/explore/banner/skeleton'
import { HomeTitle } from './home-title'

export default function Home() {
  return (
    <>
      <HomeTitle />
      <AppList>
        <Suspense fallback={<BannerSkeleton />}>
          <HomeBanner />
        </Suspense>
      </AppList>
    </>
  )
}
