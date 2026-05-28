'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

type Project = {
  id: string
  name: string
  project_number: string | null
  client: string | null
  created_at: string
}

type Run = {
  id: string
  project_id: string
  revision: string | null
  status: string | null
  member_count: number | null
  total_weight: number | null
  issue_count: number | null
  summary_notes: string | null
  created_at: string
}

type Discrepancy = {
  id: string
  severity: string | null
  category: string | null
  member_mark: string | null
  input1_value: string | null
  input2_value: string | null
  input3_value: string | null
  recommended_action: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusColour = (s: string | null) => {
  if (s === 'PASS') return '#00ff9d'
  if (s === 'FAIL') return '#ff4444'
  return '#f5a623'
}

const severityColour = (s: string | null) => {
  if (s === 'CRITICAL') return '#ff4444'
  if (s === 'MAJOR') return '#f5a623'
  return '#00ff9d'
}

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [runs, setRuns] = useState<Record<string, Run[]>>({})
  const [selectedRun, setSelectedRun] = useState<Run | null>(null)
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [discLoading, setDiscLoading] = useState(false)

  // Load all projects on mount
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })

      if (!error && data) {
        setProjects(data)
        // Load runs for all projects in parallel
        const runMap: Record<string, Run[]> = {}
        await Promise.all(
          data.map(async (p) => {
            const { data: rData } = await supabase
              .from('runs')
              .select('*')
              .eq('project_id', p.id)
              .order('created_at', { ascending: false })
            runMap[p.id] = rData ?? []
          })
        )
        setRuns(runMap)
      }
      setLoading(false)
    }
    load()
  }, [])

  // Load discrepancies for a selected run
  const selectRun = async (run: Run) => {
    setSelectedRun(run)
    setDiscLoading(true)
    const { data } = await supabase
      .from('discrepancies')
      .select('*')
      .eq('run_id', run.id)
      .order('severity', { ascending: true })
    setDiscrepancies(data ?? [])
    setDiscLoading(false)
  }

  const toggleProject = (id: string) =>
    setExpandedProjects(prev => ({ ...prev, [id]: !prev[id] }))

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#e0e0e0',
      fontFamily: "'IBM Plex Mono', monospace",
      padding: '2rem',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: '2rem', color: '#00ff9d', margin: 0 }}>
            QAi Dashboard
          </h1>
          <p style={{ color: '#666', margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
            Project history &amp; revision tracker
          </p>
        </div>
        <Link href="/" style={{
          background: '#00ff9d',
          color: '#0a0a0a',
          padding: '0.5rem 1.25rem',
          borderRadius: '6px',
          textDecoration: 'none',
          fontWeight: 700,
          fontSize: '0.85rem',
        }}>
          + New Analysis
        </Link>
      </div>

      {loading && (
        <p style={{ color: '#666', textAlign: 'center', marginTop: '4rem' }}>Loading projects...</p>
      )}

      {!loading && projects.length === 0 && (
        <div style={{ textAlign: 'center', marginTop: '6rem', color: '#444' }}>
          <p style={{ fontSize: '1.2rem' }}>No projects yet.</p>
          <p style={{ fontSize: '0.85rem' }}>Run your first QAi analysis to see it here.</p>
        </div>
      )}

      {/* Layout: project list + run detail */}
      {!loading && projects.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedRun ? '1fr 1.6fr' : '1fr', gap: '1.5rem', alignItems: 'start' }}>

          {/* Left — Project + Run list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {projects.map(p => (
              <div key={p.id} style={{
                background: '#111',
                border: '1px solid #222',
                borderRadius: '10px',
                overflow: 'hidden',
              }}>
                {/* Project header */}
                <div
                  onClick={() => toggleProject(p.id)}
                  style={{
                    padding: '1rem 1.25rem',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: expandedProjects[p.id] ? '1px solid #222' : 'none',
                  }}
                >
                  <div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: '1rem', color: '#fff' }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#555', marginTop: '0.2rem' }}>
                      {runs[p.id]?.length ?? 0} run(s) · Created {fmt(p.created_at)}
                    </div>
                  </div>
                  <span style={{ color: '#444', fontSize: '1rem' }}>
                    {expandedProjects[p.id] ? '▲' : '▼'}
                  </span>
                </div>

                {/* Runs list */}
                {expandedProjects[p.id] && (
                  <div>
                    {(runs[p.id] ?? []).length === 0 && (
                      <p style={{ padding: '1rem', color: '#444', fontSize: '0.8rem' }}>No runs found.</p>
                    )}
                    {(runs[p.id] ?? []).map((run, i) => (
                      <div
                        key={run.id}
                        onClick={() => selectRun(run)}
                        style={{
                          padding: '0.85rem 1.25rem',
                          borderBottom: i < (runs[p.id].length - 1) ? '1px solid #1a1a1a' : 'none',
                          cursor: 'pointer',
                          background: selectedRun?.id === run.id ? '#1a2a1a' : 'transparent',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          transition: 'background 0.15s',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.82rem', color: '#ccc' }}>
                            Rev: <strong>{run.revision ?? '—'}</strong>
                            &nbsp;·&nbsp;
                            <span style={{ color: statusColour(run.status), fontWeight: 700 }}>
                              {run.status ?? '—'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#555', marginTop: '0.2rem' }}>
                            {fmt(run.created_at)} · {run.issue_count ?? 0} issues
                          </div>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#444' }}>
                          {run.member_count ? `${run.member_count} mbrs` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right — Run detail panel */}
          {selectedRun && (
            <div style={{
              background: '#111',
              border: '1px solid #222',
              borderRadius: '10px',
              padding: '1.5rem',
              position: 'sticky',
              top: '2rem',
            }}>
              {/* Run summary */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: '1.1rem', color: '#fff', fontWeight: 700 }}>
                    Revision: {selectedRun.revision ?? '—'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.2rem' }}>
                    {fmt(selectedRun.created_at)}
                  </div>
                </div>
                <span style={{
                  background: statusColour(selectedRun.status) + '22',
                  color: statusColour(selectedRun.status),
                  border: `1px solid ${statusColour(selectedRun.status)}55`,
                  padding: '0.3rem 0.9rem',
                  borderRadius: '20px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}>
                  {selectedRun.status ?? '—'}
                </span>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {[
                  { label: 'Members', value: selectedRun.member_count ?? '—' },
                  { label: 'Total Weight', value: selectedRun.total_weight ? `${selectedRun.total_weight} kg` : '—' },
                  { label: 'Issues', value: selectedRun.issue_count ?? 0 },
                ].map(s => (
                  <div key={s.label} style={{
                    background: '#0a0a0a',
                    border: '1px solid #1e1e1e',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#00ff9d' }}>{s.value}</div>
                    <div style={{ fontSize: '0.68rem', color: '#555', marginTop: '0.2rem' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Summary notes */}
              {selectedRun.summary_notes && (
                <div style={{
                  background: '#0a0a0a',
                  border: '1px solid #1e1e1e',
                  borderRadius: '8px',
                  padding: '1rem',
                  fontSize: '0.78rem',
                  color: '#aaa',
                  lineHeight: 1.6,
                  marginBottom: '1.25rem',
                }}>
                  {selectedRun.summary_notes}
                </div>
              )}

              {/* Discrepancies */}
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: '0.9rem', color: '#fff', marginBottom: '0.75rem' }}>
                Discrepancies ({discrepancies.length})
              </div>

              {discLoading && <p style={{ color: '#555', fontSize: '0.8rem' }}>Loading...</p>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '50vh', overflowY: 'auto' }}>
                {discrepancies.map(d => (
                  <div key={d.id} style={{
                    background: '#0a0a0a',
                    border: `1px solid ${severityColour(d.severity)}33`,
                    borderLeft: `3px solid ${severityColour(d.severity)}`,
                    borderRadius: '8px',
                    padding: '0.85rem 1rem',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: severityColour(d.severity) }}>
                        {d.severity}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#555' }}>
                        {d.category} {d.member_mark ? `· ${d.member_mark}` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#888', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {d.input1_value && <div><span style={{ color: '#555' }}>DOC: </span>{d.input1_value}</div>}
                      {d.input2_value && <div><span style={{ color: '#555' }}>MDL: </span>{d.input2_value}</div>}
                      {d.input3_value && <div><span style={{ color: '#555' }}>FAB: </span>{d.input3_value}</div>}
                    </div>
                    {d.recommended_action && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#00ff9d' }}>
                        → {d.recommended_action}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}