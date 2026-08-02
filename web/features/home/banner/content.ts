type BannerContent = {
  category: string
  description: string
  'img-src': string
  title: string
}

export function getBannerContent(content: unknown): BannerContent {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { category: '', description: '', 'img-src': '', title: '' }
  }

  const value = content as Record<string, unknown>
  return {
    category: typeof value.category === 'string' ? value.category : '',
    description: typeof value.description === 'string' ? value.description : '',
    'img-src': typeof value['img-src'] === 'string' ? value['img-src'] : '',
    title: typeof value.title === 'string' ? value.title : '',
  }
}
