'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

export default function ManageConnectionButton(props: Omit<ButtonProps, 'children' | 'variant'>) {
  const { t } = useTranslation(['share'])

  return (
    <Button variant="secondary-accent" {...props}>
      {t(($) => $['connections.configure.manage'], { ns: 'share' })}
    </Button>
  )
}
