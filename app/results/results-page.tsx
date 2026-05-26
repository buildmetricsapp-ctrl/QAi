'use client'

import { useEffect, useState } from 'react'

export default function Results() {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('qai_result')
    if (stored) setData(JSON.parse(stored))
  }, [])

  if (!data) return (
    <main style={{ background: '#0a0e1a', minHeight: '100vh', color: '#e8eaf0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
        <p style={{ color: 'rgba(255,255,255,0.4)' }}>No analysis data found. <a href="/" style={{ color: '#4a9eff' }}>Run a new analysis</a></p>
      </div>
    </main>
  )

  const summary = data.project_summary
  const discrepancies = data.discrepancies || []

  const statusColor = summary.overall_status === 'PASS'
    ? '#2dd4a0'
    : summary.overall_status === 'FAIL'
    ? '#ff6b6b'
    : '#f59e0b'

  return (
    <main style={{ background: '#0a0e1a', minHeight: '100vh', color: '#e8eaf0', fontFamily: 'DM Sans, sans-serif', padding: '0 0 80px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 48px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1 }}>
            <span style={{ color: '#4a9eff' }}>Q</span><span>Ai</span>
          </div>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.35)', paddingLeft: 16, borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
            Analysis Results
          </div>
        </div>
        <a href="/" style={{ fontSize: 13, color: '#4a9eff', textDecoration: 'none' }}>← New analysis</a>
      </header>

      <div style={{ maxWidth: 960, margin: '48px auto 0', padding: '0 24px' }}>

        {/* Status banner */}
        <div style={{ background: `${statusColor}12`, border: `1px solid ${statusColor}30`, borderRadius: 16, padding: '24px 32px', marginBottom: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: statusColor, marginBottom: 6 }}>Overall status</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: statusColor }}>{summary.overall_status}</div>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: '10px 0 0', lineHeight: 1.6, maxWidth: 560 }}>{summary.summary_note}</p>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            {[
              { label: 'Critical', val: summary.critical, color: '#ff6b6b' },
              { label: 'Major',    val: summary.major,    color: '#f59e0b' },
              { label: 'Minor',    val: summary.minor,    color: '#a78bfa' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Discrepancy list */}
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Discrepancies ({discrepancies.length})</h2>

        {discrepancies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No discrepancies found — all inputs are consistent.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
            {discrepancies.map((d: any) => {
              const sc = d.severity === 'CRITICAL' ? '#ff6b6b' : d.severity === 'MAJOR' ? '#f59e0b' : '#a78bfa'
              return (
                <div key={d.id} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.07)`, borderLeft: `3px solid ${sc}`, borderRadius: 12, padding: '20px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: sc, textTransform: 'uppercase' as const }}>{d.severity}</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{d.id}</span>
                    <span style={{ fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4, color: 'rgba(255,255,255,0.5)' }}>{d.category}</span>
                    {d.member_mark && <span style={{ fontSize: 12, color: '#4a9eff' }}>Mark: {d.member_mark}</span>}
                  </div>
                  <p style={{ fontSize: 14, color: '#e8eaf0', margin: '0 0 12px', lineHeight: 1.6 }}>{d.description}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                    {[
                      { label: 'Spec says', val: d.input1_says, color: '#4a9eff' },
                      { label: 'Model shows', val: d.input2_says, color: '#2dd4a0' },
                      { label: 'Fab output', val: d.input3_says, color: '#a78bfa' },
                    ].map(row => (
                      <div key={row.label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: row.color, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 4 }}>{row.label}</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{row.val || '—'}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, color: '#f59e0b', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>Recommended action  </span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{d.recommended_action}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
