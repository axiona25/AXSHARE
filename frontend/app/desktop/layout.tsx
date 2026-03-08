/**
 * Layout per il client desktop AXSHARE (finestra compatta).
 * Esclude sidebar e header della web app.
 */
export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        width: '420px',
        height: '580px',
        overflow: 'hidden',
        background: 'var(--ax-bg-primary, var(--ax-surface-0))',
      }}
    >
      {children}
    </div>
  )
}
