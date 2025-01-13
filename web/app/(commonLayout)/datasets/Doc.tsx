'use client'

import { useEffect, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiListUnordered } from '@remixicon/react'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'

type DocProps = {
  apiBaseUrl: string
}

const Doc = ({ apiBaseUrl }: DocProps) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const [toc, setToc] = useState<Array<{ href: string; text: string }>>([])
  const [isTocExpanded, setIsTocExpanded] = useState(false)

  // Set initial TOC expanded state based on screen width
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)')
    setIsTocExpanded(mediaQuery.matches)
  }, [])

  // Extract TOC from article content
  useEffect(() => {
    const extractTOC = () => {
      const article = document.querySelector('article')
      if (article) {
        const headings = article.querySelectorAll('h2')
        const tocItems = Array.from(headings).map((heading) => {
          const anchor = heading.querySelector('a')
          if (anchor) {
            return {
              href: anchor.getAttribute('href') || '',
              text: anchor.textContent || '',
            }
          }
          return null
        }).filter((item): item is { href: string; text: string } => item !== null)
        setToc(tocItems)
      }
    }

    setTimeout(extractTOC, 0)
  }, [locale])

  // Handle TOC item click
  const handleTocClick = (e: React.MouseEvent<HTMLAnchorElement>, item: { href: string; text: string }) => {
    e.preventDefault()
    const targetId = item.href.replace('#', '')
    const element = document.getElementById(targetId)
    if (element) {
      const scrollContainer = document.querySelector('.scroll-container')
      if (scrollContainer) {
        const headerOffset = -40
        const elementTop = element.offsetTop - headerOffset
        scrollContainer.scrollTo({
          top: elementTop,
          behavior: 'smooth',
        })
      }
    }
  }

  return (
    <div className="flex">
      <div className={`fixed right-16 top-32 z-10 transition-all ${isTocExpanded ? 'w-64' : 'w-10'}`}>
        {isTocExpanded
          ? (
            <nav className="toc w-full bg-gray-50 p-4 rounded-lg shadow-md max-h-[calc(100vh-150px)] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">{t('appApi.develop.toc')}</h3>
                <button
                  onClick={() => setIsTocExpanded(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                ✕
                </button>
              </div>
              <ul className="space-y-2">
                {toc.map((item, index) => (
                  <li key={index}>
                    <a
                      href={item.href}
                      className="text-gray-600 hover:text-gray-900 hover:underline transition-colors duration-200"
                      onClick={e => handleTocClick(e, item)}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )
          : (
            <button
              onClick={() => setIsTocExpanded(true)}
              className="w-10 h-10 bg-gray-50 rounded-full shadow-md flex items-center justify-center hover:bg-gray-100 transition-colors duration-200"
            >
              <RiListUnordered className="w-6 h-6" />
            </button>
          )}
      </div>
      <article className='mx-1 px-4 sm:mx-12 pt-16 bg-white rounded-t-xl prose prose-xl'>
        {locale !== LanguagesSupported[1]
          ? <TemplateEn apiBaseUrl={apiBaseUrl} />
          : <TemplateZh apiBaseUrl={apiBaseUrl} />
        }
      </article>
    </div>
  )
}

export default Doc
