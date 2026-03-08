'use client'

import React, { useEffect, useRef, useState } from 'react'

const ROW_HEIGHT = 52
const HEADER_ROW_HEIGHT = 52

export interface FileTableColumn {
  key: string
  label: string
  width?: string
}

export interface FileTableProps {
  columns: FileTableColumn[]
  rows: React.ReactNode[]
  emptyMessage?: string
}

export function FileTable({ columns, rows, emptyMessage }: FileTableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [availableHeight, setAvailableHeight] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { height } = entries[0].contentRect
      setAvailableHeight(height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bodyHeight = Math.max(0, availableHeight - HEADER_ROW_HEIGHT)
  const visibleRows = Math.max(0, Math.floor(bodyHeight / ROW_HEIGHT))
  const hasOverflow = rows.length >= visibleRows && visibleRows > 0
  const showEmptyState = rows.length === 0 && emptyMessage != null
  const emptyRowCount =
    !hasOverflow && visibleRows > 0
      ? showEmptyState
        ? Math.max(0, visibleRows - 1)
        : Math.max(0, visibleRows - rows.length)
      : 0

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: hasOverflow ? 'auto' : 'visible',
        }}
      >
        <table
          className="file-table"
          style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            tableLayout: 'fixed',
          }}
        >
          <thead
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: 'var(--ax-bg-primary, #fff)',
            }}
          >
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    width: col.width,
                    padding: '10px 20px',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: 12,
                    color: 'var(--ax-muted)',
                    letterSpacing: '0.04em',
                    borderBottom: '1px solid var(--ax-surface-2)',
                    boxSizing: 'border-box',
                    height: HEADER_ROW_HEIGHT,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="file-table-tbody-fixed">
            {showEmptyState && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="file-table-empty-cell"
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--ax-muted)',
                    height: ROW_HEIGHT,
                    borderBottom: '1px solid var(--ax-surface-2)',
                  }}
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!showEmptyState && rows}
            {!showEmptyState &&
              emptyRowCount > 0 &&
              Array.from({ length: emptyRowCount }).map((_, i) => (
                <tr
                  key={`empty-${i}`}
                  className="file-table-empty-row"
                  aria-hidden
                  style={{ height: ROW_HEIGHT }}
                >
                  <td
                    colSpan={columns.length}
                    className="file-table-empty-cell"
                    style={{
                      height: ROW_HEIGHT,
                      borderBottom: 'none',
                      border: 'none',
                    }}
                  />
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
