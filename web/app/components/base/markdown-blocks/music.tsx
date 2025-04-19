import abcjs from 'abcjs'
import { useEffect, useRef } from 'react'
import 'abcjs/abcjs-audio.css'

const MarkdownMusic = ({ children }: { children: React.ReactNode }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current && controlsRef.current) {
      if (typeof children === 'string') {
        const visualObjs = abcjs.renderAbc(containerRef.current, children, {
          add_classes: true, // Add classes to SVG elements for cursor tracking
          responsive: 'resize', // Make notation responsive
        })
        const synthControl = new abcjs.synth.SynthController()
        synthControl.load(controlsRef.current, {}, { displayPlay: true })
        const synth = new abcjs.synth.CreateSynth()
        const visualObj = visualObjs[0]
        synth.init({ visualObj }).then(() => {
          synthControl.setTune(visualObj, false)
        })
        containerRef.current.style.overflow = 'auto'
      }
    }
  }, [children])

  return (
    <div style={{ minWidth: '100%', overflow: 'auto' }}>
      <div ref={containerRef} />
      <div ref={controlsRef} />
    </div>
  )
}
MarkdownMusic.displayName = 'MarkdownMusic'

export default MarkdownMusic
