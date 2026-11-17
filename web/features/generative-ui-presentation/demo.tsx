'use client'

import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import { InterfacePreview } from './interface-preview'

export function Demo({ active }: { active: boolean }) {
  const { t } = useTranslation(['presentation', 'common'])
  const [showReplay, setShowReplay] = useState(false)
  const [replayId, setReplayId] = useState(0)

  if (showReplay) {
    return (
      <div className="demo-replay">
        <div>
          <p className="cover-eyebrow">Live Demo</p>
          <h2>{t(($) => $['demo.replay'])}</h2>
          <p className="slide-lead">{t(($) => $['demo.replayHint'])}</p>
          <div className="replay-controls">
            <Button size="large" variant="secondary" onClick={() => setShowReplay(false)}>
              <span aria-hidden="true" className="i-ri-arrow-left-line size-4" />
              {t(($) => $['operation.back'], { ns: 'common' })}
            </Button>
            <Button size="large" variant="secondary" onClick={() => setReplayId((id) => id + 1)}>
              <span aria-hidden="true" className="i-ri-restart-line size-4" />
              {t(($) => $['operation.reset'], { ns: 'common' })}
            </Button>
          </div>
        </div>
        <div className="replay-preview">{active && <InterfacePreview key={replayId} replay />}</div>
      </div>
    )
  }

  return (
    <>
      <div className="demo-symbol" aria-hidden="true">
        <span className="i-ri-play-large-fill" />
      </div>
      <h2>Live Demo</h2>
      <p className="slide-lead">{t(($) => $['demo.description'])}</p>
      <div className="demo-actions">
        <Link
          href="/apps"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'primary', size: 'large', className: 'demo-start' })}
        >
          {t(($) => $['demo.openApps'])}
          <span aria-hidden="true" className="i-ri-arrow-right-up-line size-5" />
        </Link>
        <Button
          size="large"
          variant="secondary"
          className="demo-replay-trigger"
          onClick={() => setShowReplay(true)}
        >
          <span aria-hidden="true" className="i-ri-replay-10-line size-5" />
          {t(($) => $['demo.replay'])}
        </Button>
      </div>
    </>
  )
}
