'use client'

import type { RevealApi, RevealConfig } from 'reveal.js'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Deck, Slide } from '@revealjs/react'
import { Fragment, useRef, useState } from 'react'
import RevealNotes from 'reveal.js/plugin/notes'
import { useTranslation } from '#i18n'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import { Architecture } from './architecture'
import { createCompositionExample } from './composition-example'
import { Demo } from './demo'
import { ExistingCapabilities } from './existing-capabilities'
import { InterfacePreview } from './interface-preview'
import { speakerNotes } from './speaker-notes'
import 'reveal.js/reveal.css'
import './presentation.css'

const config: RevealConfig = {
  width: 1600,
  height: 900,
  margin: 0,
  minScale: 0.1,
  maxScale: 2,
  embedded: true,
  center: false,
  hash: true,
  fragmentInURL: true,
  controls: false,
  progress: false,
  slideNumber: false,
  transition: 'fade',
  transitionSpeed: 'fast',
  backgroundTransition: 'none',
  scrollActivationWidth: 0,
  pdfSeparateFragments: false,
  pdfMaxPagesPerSlide: 1,
  keyboardCondition: (event) =>
    !event.defaultPrevented &&
    !event.isComposing &&
    !(
      event.target instanceof Element &&
      event.target.closest('button, a, summary, select, [role="combobox"], [role="listbox"]')
    ),
}

export default function PresentationDeck() {
  const { t } = useTranslation(['presentation', 'common'])
  const deckRef = useRef<RevealApi | null>(null)
  const [notesPlugin] = useState(RevealNotes)
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const compositionLines = createCompositionExample({
    sales: t(($) => $['preview.sales']),
    trend: t(($) => $['preview.trend']),
    feedback: t(($) => $['threshold.formField']),
    submit: t(($) => $['operation.submit'], { ns: 'common' }),
    confirm: t(($) => $['operation.confirm'], { ns: 'common' }),
  })
  const titles = [
    'Dify Generative UI',
    t(($) => $['positioning.audience']),
    t(($) => $['threshold.title']),
    t(($) => $['technology.title']),
    t(($) => $['architecture.title']),
    'Live Demo',
    'Q&A',
  ]

  return (
    <div className="generative-ui-presentation">
      <header className="presentation-header">
        <DifyLogo alt="Dify" size="large" />
        <span className="presentation-header-title">GENERATIVE UI</span>
        <div className="presentation-tools">
          <IconButton
            aria-label={t(($) => $['toolbar.overview'])}
            onClick={() => deckRef.current?.toggleOverview()}
            disabled={!ready}
          >
            <span aria-hidden="true" className="i-ri-layout-grid-line size-4" />
          </IconButton>
          <IconButton
            aria-label={t(($) => $['toolbar.notes'])}
            onClick={() => notesPlugin.open()}
            disabled={!ready}
          >
            <span aria-hidden="true" className="i-ri-slideshow-3-line size-4" />
          </IconButton>
          <IconButton
            aria-label={t(($) => $['operation.toggleFullscreen'], { ns: 'common' })}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen()
              else void document.documentElement.requestFullscreen()
            }}
          >
            <span aria-hidden="true" className="i-ri-fullscreen-line size-4" />
          </IconButton>
        </div>
      </header>

      <div className="presentation-stage">
        <Deck
          deckRef={deckRef}
          config={config}
          plugins={[notesPlugin]}
          onReady={(deck) => {
            setIndex(deck.getIndices().h)
            setReady(true)
          }}
          onSlideChange={() => setIndex(deckRef.current!.getIndices().h)}
        >
          <Slide className="cover-slide" aria-label={titles[0]} notes={speakerNotes.cover}>
            <div className="cover-layout">
              <div className="cover-copy">
                <p className="cover-eyebrow">Dify</p>
                <h1 aria-label="Dify Generative UI">
                  Generative
                  <br />
                  <span>UI</span>
                  <span className="cover-period">.</span>
                </h1>
                <p className="cover-subtitle">{t(($) => $['cover.subtitle'])}</p>
                <div className="cover-line" aria-hidden="true" />
                <p className="cover-label">OpenUI Lang + Dify</p>
              </div>
              <div className="cover-preview">
                <InterfacePreview />
              </div>
            </div>
          </Slide>

          <Slide
            className="positioning-slide"
            aria-label={titles[1]}
            notes={speakerNotes.positioning}
          >
            <p className="slide-eyebrow">{t(($) => $['positioning.audience'])}</p>
            <h2>{t(($) => $['positioning.title'])}</h2>
            <div className="positioning-content">
              <ol className="positioning-list">
                {[
                  t(($) => $['positioning.select']),
                  t(($) => $['positioning.compose']),
                  t(($) => $['positioning.reduce']),
                ].map((text, itemIndex) => (
                  <li key={text}>
                    <span className="list-number">{String(itemIndex + 1).padStart(2, '0')}</span>
                    {text}
                  </li>
                ))}
              </ol>
              <div className="component-composition" aria-label="Dify UI">
                <div className="composition-heading">
                  <span aria-hidden="true" className="i-ri-sparkling-2-line" />
                  OpenUI Lang
                </div>
                <pre className="composition-code">
                  <code>
                    {compositionLines.map(([name, expression]) => (
                      <Fragment key={name}>
                        <span className="composition-variable">{name}</span>
                        {` = ${expression}\n`}
                      </Fragment>
                    ))}
                  </code>
                </pre>
                <div className="composition-foot">Dify UI</div>
              </div>
            </div>
          </Slide>

          <Slide className="threshold-slide" aria-label={titles[2]} notes={speakerNotes.threshold}>
            <ExistingCapabilities />
          </Slide>

          <Slide
            className="technology-slide"
            aria-label={titles[3]}
            notes={speakerNotes.technology}
          >
            <h2>{t(($) => $['technology.title'])}</h2>
            <dl className="technology-rows">
              {[
                {
                  name: 'OpenUI Lang',
                  description: t(($) => $['technology.language']),
                  icon: 'i-ri-code-box-line',
                },
                {
                  name: 'OpenUI React Renderer',
                  description: t(($) => $['technology.renderer']),
                  icon: 'i-ri-reactjs-line',
                },
                {
                  name: 'Dify UI',
                  description: t(($) => $['technology.components']),
                  icon: 'i-ri-layout-masonry-line',
                },
              ].map((technology, technologyIndex) => (
                <div key={technology.name} className="technology-row">
                  <span className="technology-number">0{technologyIndex + 1}</span>
                  <dt>
                    <span aria-hidden="true" className={technology.icon} />
                    {technology.name}
                  </dt>
                  <dd>{technology.description}</dd>
                </div>
              ))}
            </dl>
            <div className="technology-footer">
              <p>{t(($) => $['technology.footer'])}</p>
              <a
                className="technology-source"
                href="https://www.openui.com/docs/openui-lang/comparison#feature-comparison"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(($) => $['technology.comparison'])}
                <span aria-hidden="true" className="i-ri-external-link-line" />
              </a>
            </div>
          </Slide>

          <Slide className="architecture-slide" aria-label={titles[4]}>
            <h2>{t(($) => $['architecture.title'])}</h2>
            <Architecture />
            <aside className="notes">
              <ol>
                {speakerNotes.architecture.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </aside>
          </Slide>

          <Slide className="demo-slide" aria-label={titles[5]}>
            <Demo active={index === 5} />
            <aside className="notes">
              {speakerNotes.demo.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </aside>
          </Slide>

          <Slide className="qa-slide" aria-label={titles[6]} notes={speakerNotes.qa}>
            <div className="qa-layout">
              <div className="qa-mark" aria-hidden="true">
                ?
              </div>
              <div className="qa-copy">
                <p className="cover-eyebrow">Dify Generative UI</p>
                <h2>
                  Q<span>&</span>A
                </h2>
                <p className="slide-lead">{t(($) => $['qa.subtitle'])}</p>
              </div>
            </div>
          </Slide>
        </Deck>
      </div>

      <footer className="presentation-footer">
        <p className="presentation-keyboard-hint">{t(($) => $['navigation.hint'])}</p>
        <nav className="presentation-pagination" aria-label={t(($) => $['navigation.label'])}>
          {titles.map((title, slideIndex) => (
            <button
              key={title}
              type="button"
              aria-label={title}
              aria-current={index === slideIndex ? 'page' : undefined}
              disabled={!ready}
              onClick={() => deckRef.current?.slide(slideIndex, 0, -1)}
            >
              {String(slideIndex + 1).padStart(2, '0')}
            </button>
          ))}
        </nav>
        <div className="presentation-arrows">
          <span className="presentation-page-count">
            {String(index + 1).padStart(2, '0')}
            <span> / 07</span>
          </span>
          <IconButton
            aria-label={t(($) => $['pagination.previous'], { ns: 'common' })}
            disabled={!ready || index === 0}
            onClick={() => deckRef.current?.prev()}
          >
            <span aria-hidden="true" className="i-ri-arrow-left-line size-5" />
          </IconButton>
          <IconButton
            aria-label={t(($) => $['pagination.next'], { ns: 'common' })}
            disabled={!ready || index === 6}
            onClick={() => deckRef.current?.next()}
          >
            <span aria-hidden="true" className="i-ri-arrow-right-line size-5" />
          </IconButton>
        </div>
      </footer>
    </div>
  )
}
