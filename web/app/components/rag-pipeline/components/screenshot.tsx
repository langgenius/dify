import React from 'react'
import useTheme from '@/hooks/use-theme'
import { basePath } from '@/utils/var'
import Image from 'next/image'

const PipelineScreenShot = () => {
  const { theme } = useTheme()

  return (
    <picture>
      <source media="(resolution: 1x)" srcSet={`${basePath}/screenshots/${theme}/Pipeline.png`} />
      <source media="(resolution: 2x)" srcSet={`${basePath}/screenshots/${theme}/Pipeline@2x.png`} />
      <source media="(resolution: 3x)" srcSet={`${basePath}/screenshots/${theme}/Pipeline@3x.png`} />
      <Image
        src={`${basePath}/screenshots/${theme}/Pipeline.png`}
        alt='Pipeline Screenshot'
        width={692} height={456} />
    </picture>
  )
}

export default React.memo(PipelineScreenShot)
