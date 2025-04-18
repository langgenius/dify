import abcjs from 'abcjs'
import { useEffect, useRef } from 'react'

const MarkdownMusic = ({ children }: { children: React.ReactNode }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      if (typeof children === 'string') {
        abcjs.renderAbc(containerRef.current, children)
        containerRef.current.style.overflow = 'auto'
      }
    }
  }, [children])
  return <div style={{ minHeight: '350px', minWidth: '100%', overflow: 'auto' }} ref={containerRef} />
}
MarkdownMusic.displayName = 'MarkdownMusic'

export default MarkdownMusic
