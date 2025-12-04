'use client'

import { scan } from 'react-scan'
import { useEffect } from 'react'
import { IS_DEV } from '@/config'

export function ReactScan() {
  useEffect(() => {
    if (IS_DEV) {
      scan({
        enabled: true,
        // HACK: react-scan's getIsProduction() incorrectly detects Next.js dev as production
        // because Next.js devtools overlay uses production React build
        // Issue: https://github.com/aidenybai/react-scan/issues/402
        // TODO: remove this option after upstream fix
        dangerouslyForceRunInProduction: true,
      })
    }
  }, [])

  return null
}
