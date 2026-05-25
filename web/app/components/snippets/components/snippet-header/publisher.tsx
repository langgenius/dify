'use client'

import { Button } from '@langgenius/dify-ui/button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

type PublisherProps = {
  isPublishing: boolean
  onPublish: () => void
}

const Publisher = ({
  isPublishing,
  onPublish,
}: PublisherProps) => {
  const { t } = useTranslation('snippet')

  return (
    <Button
      variant="primary"
      loading={isPublishing}
      disabled={isPublishing}
      onClick={onPublish}
    >
      {t('save')}
    </Button>
  )
}

export default memo(Publisher)
