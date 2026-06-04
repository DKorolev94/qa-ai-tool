import { useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'loading' | 'finishing' | 'fading'

export function ProgressBar({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [width, setWidth] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const phaseRef = useRef<Phase>('idle')

  function clear() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  function after(ms: number, fn: () => void) {
    const t = setTimeout(fn, ms)
    timers.current.push(t)
  }
  function setPhaseSync(p: Phase) {
    phaseRef.current = p
    setPhase(p)
  }

  useEffect(() => {
    if (active) {
      clear()
      setPhaseSync('loading')
      setWidth(0)
      // staged crawl: fast start → slows as it "waits" for server
      after(40,   () => setWidth(12))
      after(160,  () => setWidth(30))
      after(1000, () => setWidth(55))
      after(3500, () => setWidth(72))
      after(8000, () => setWidth(84))
      after(15000,() => setWidth(91))
    } else {
      if (phaseRef.current !== 'loading') return
      clear()
      setPhaseSync('finishing')
      setWidth(100)
      after(250, () => setPhaseSync('fading'))
      after(650, () => { setPhaseSync('idle'); setWidth(0) })
    }
    return clear
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'idle') return null

  return (
    <div className="progress-bar">
      <div
        className={`progress-bar-fill${phase === 'fading' ? ' pb-fading' : ''}`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
