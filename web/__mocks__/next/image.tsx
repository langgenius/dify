import React from 'react'

const MockImage = ({ src, alt, ...props }: { src: string; alt?: string; [key: string]: any }) => {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={typeof src === 'string' ? src : ''} alt={alt || ''} {...props} />
}

export default MockImage
