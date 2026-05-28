import { useEffect, useRef, useState } from 'react'

interface Props {
  active: boolean
}

export function ProgressBar({ active }: Props) {
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const valRef = useRef(0)

  useEffect(() => {
    if (active) {
      valRef.current = 0
      setWidth(0)
      setVisible(true)
      requestAnimationFrame(() => {
        timerRef.current = setInterval(() => {
          valRef.current += (85 - valRef.current) * 0.04
          setWidth(valRef.current)
        }, 250)
      })
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      setWidth(100)
      const t = setTimeout(() => { setVisible(false); setWidth(0) }, 600)
      return () => clearTimeout(t)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [active])

  if (!visible && !active) return null

  return (
    <div className="progress-topbar">
      <div
        className="progress-topbar-track"
        style={{
          width: `${width}%`,
          transition: active ? 'width 0.25s linear' : 'width 0.3s ease, opacity 0.3s ease',
          opacity: width === 100 && !active ? 0 : 1,
        }}
      />
    </div>
  )
}
