'use client'
import { useEffect } from 'react'

export default function DesktopLayout({
  children
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    document.documentElement.classList.add('ax-desktop-active')
    document.body.classList.add('ax-desktop-active')
    return () => {
      document.documentElement.classList.remove('ax-desktop-active')
      document.body.classList.remove('ax-desktop-active')
    }
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a')
      if (anchor && !anchor.href.includes('/desktop')) {
        e.preventDefault()
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  return (
    <div className="ax-desktop-root" style={{ userSelect: 'none' }}>
      <div className="ax-desktop-bg" aria-hidden />
      <div className="ax-desktop-grid" aria-hidden />
      <div className="ax-desktop-container">
        {children}
      </div>
    </div>
  )
}
