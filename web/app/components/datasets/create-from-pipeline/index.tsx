'use client'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import Effect from '../../base/effect'
import Footer from './footer'
import Header from './header'
import List from './list'

const CreateFromPipeline = () => {
  const { t } = useTranslation()
  useDocumentTitle(
    t(($) => $['stepByStepTour.guides.knowledge.empty.pipeline.title'], { ns: 'common' }),
  )

  return (
    <div className="relative flex h-[calc(100vh-56px)] flex-col overflow-hidden rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle">
      <Effect className="-top-8.5 left-8 opacity-20" />
      <Header />
      <List />
      <Footer />
    </div>
  )
}

export default CreateFromPipeline
