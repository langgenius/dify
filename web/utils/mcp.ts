export const shouldUseMcpIcon = (src: any): boolean => {
  return typeof src === 'object' && src?.content === '🔗'
}

export const shouldUseMcpIconForAppIcon = (iconType: string, icon: string): boolean => {
  return iconType === 'emoji' && icon === '🔗'
}
