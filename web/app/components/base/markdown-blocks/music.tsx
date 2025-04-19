import abcjs from 'abcjs'
import { useEffect, useRef } from 'react'
import 'abcjs/abcjs-audio.css'

const MarkdownMusic = ({ children }: { children: React.ReactNode }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current && controlsRef.current) {
      if (typeof children === 'string') {
        abcjs.renderAbc(containerRef.current, children)
        const synthControl = new abcjs.synth.SynthController()
        synthControl.load(controlsRef.current, {}, { displayPlay: true })
        const synth = new abcjs.synth.CreateSynth()
        const visualObj = abcjs.renderAbc(containerRef.current, children)[0]
        synth.init({ visualObj }).then(() => {
          synthControl.setTune(visualObj, false)
        })
        containerRef.current.style.overflow = 'auto'
      }
    }
  }, [children])

  return (
    <div style={{ minHeight: '350px', minWidth: '100%', overflow: 'auto' }}>
      <div ref={containerRef} />
      <div
        ref={controlsRef}
      />
    </div>
  )
}
MarkdownMusic.displayName = 'MarkdownMusic'

export default MarkdownMusic
