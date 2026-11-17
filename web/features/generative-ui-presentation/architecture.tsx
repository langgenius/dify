'use client'

import { Fragment } from '@revealjs/react'
import { useTranslation } from '#i18n'

export function Architecture() {
  const { t } = useTranslation(['presentation'])
  const nodes = [
    {
      id: 'request',
      x: 20,
      title: t(($) => $['architecture.request']),
      detail: 'Request',
      icon: 'i-ri-chat-3-line',
    },
    {
      id: 'workflow',
      x: 295,
      title: t(($) => $['architecture.workflow']),
      detail: 'Dify',
      icon: 'i-ri-flow-chart',
    },
    {
      id: 'model',
      x: 570,
      title: t(($) => $['architecture.model']),
      detail: 'LLM',
      icon: 'i-ri-brain-line',
    },
    {
      id: 'renderer',
      x: 845,
      title: t(($) => $['architecture.renderer']),
      detail: 'OpenUI',
      icon: 'i-ri-code-box-line',
    },
    {
      id: 'interface',
      x: 1120,
      title: t(($) => $['architecture.interface']),
      detail: 'Interface',
      icon: 'i-ri-layout-masonry-line',
    },
  ]
  const captions = [
    t(($) => $['architecture.step1']),
    t(($) => $['architecture.step2']),
    t(($) => $['architecture.step3']),
    t(($) => $['architecture.step4']),
    t(($) => $['architecture.step5']),
    t(($) => $['architecture.step6']),
  ]

  return (
    <div className="architecture">
      <div className="architecture-canvas">
        <svg
          className="architecture-lines"
          viewBox="0 0 1380 440"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <g className="flow-base">
            <path d="M 260 200 H 293" />
            <path d="M 535 200 H 568" />
            <path d="M 810 200 H 843" />
            <path d="M 1085 200 H 1118" />
            <path d="M 1240 263 V 352 Q 1240 370 1222 370 H 433 Q 415 370 415 352 V 265" />
            <path d="M 690 106 V 137" />
          </g>
          {[
            { id: 'request', d: 'M 260 200 H 293', index: 0 },
            { id: 'constraints', d: 'M 535 200 H 568 M 690 106 V 137', index: 1 },
            { id: 'stream', d: 'M 810 200 H 843', index: 2 },
            { id: 'render', d: 'M 1085 200 H 1118', index: 3 },
            {
              id: 'return',
              d: 'M 1240 263 V 352 Q 1240 370 1222 370 H 433 Q 415 370 415 352 V 265',
              index: 5,
            },
          ].map((line) => (
            <g key={line.id} className="fragment flow-highlight" data-fragment-index={line.index}>
              <path d={line.d} markerEnd="url(#flow-arrow)" />
              <path className="flow-particles" d={line.d} />
            </g>
          ))}
        </svg>
        <div className="architecture-constraint">{t(($) => $['architecture.constraint'])}</div>
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`architecture-node architecture-node-${node.id}`}
            style={{ left: `${(node.x / 1380) * 100}%` }}
          >
            <span aria-hidden="true" className={`architecture-node-icon ${node.icon}`} />
            <span className="architecture-node-title">{node.title}</span>
            <span className="architecture-node-detail">{node.detail}</span>
          </div>
        ))}
        <div className="architecture-stream-label">OpenUI Lang</div>
        <div className="architecture-feedback">
          <span aria-hidden="true" className="i-ri-cursor-line" />
          {t(($) => $['architecture.feedback'])}
          <span className="architecture-feedback-divider" />
          {t(($) => $['architecture.nextTurn'])}
        </div>
      </div>
      <div className="architecture-caption" aria-live="polite" aria-atomic="true">
        <p className="architecture-idle">{t(($) => $['architecture.hint'])}</p>
        {captions.map((caption, index) => (
          <Fragment key={caption} index={index} animation="current-visible" asChild>
            <p className="architecture-step" data-step={index}>
              <span className="architecture-step-number">{String(index + 1).padStart(2, '0')}</span>
              {caption}
            </p>
          </Fragment>
        ))}
      </div>
      <div className="architecture-steps" aria-hidden="true">
        {captions.map((caption, index) => (
          <Fragment key={caption} index={index} asChild>
            <span className="architecture-step-dot" />
          </Fragment>
        ))}
      </div>
    </div>
  )
}
