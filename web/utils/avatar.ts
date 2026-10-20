const avatarInitialSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function getAvatarInitial(name: string | null | undefined): string {
  for (const { segment } of avatarInitialSegmenter.segment(name?.trim() ?? ''))
    return segment.toUpperCase()
  return '?'
}
