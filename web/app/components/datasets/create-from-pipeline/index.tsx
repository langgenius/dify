'use client'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import Effect from '../../base/effect'
import Footer from './footer'
import Header from './header'
import List from './list'

const CreateFromPipeline = () => {
  const backLinkRef = useRef<HTMLAnchorElement>(null)
  const { t } = useTranslation(['onboarding'])
  useDocumentTitle(
    t(($) => $['stepByStepTour.guides.knowledge.empty.pipeline.title'], { ns: 'onboarding' }),
  )

  return (
    <div className="relative flex min-h-0 grow flex-col overflow-hidden rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle">
      <Effect className="inset-s-8 -top-8.5 opacity-20" />
      <Header backLinkRef={backLinkRef} />
      <List fallbackFocusRef={backLinkRef} />
      <Footer />
    </div>
  )
}

export default CreateFromPipeline
