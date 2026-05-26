'use client'

import { useState, useRef } from 'react'

type UploadState = {
  files: File[]
  dragging: boolean
}

const empty = (): UploadState => ({ files: [], dragging: false })

export default function Home() {
  const [input1, setInput1] = useState<UploadState>(empty())
  const [input2, setInput2] = useState<UploadState>(empty())
  const [input3, setInput3] = useState<UploadState>(empty())
  const [analysing, setAnalysing] = useState(false)
  const [error, setError] = useState('')

  const ref1 = useRef<HTMLInputElement | null>(null)
  const ref2 = useRef<HTMLInputElement | null>(null)
  const ref3 = useRef<HTMLInputElement | null>(null)

  const handleDrop = (
    e: React.DragEvent,
    setter: React.Dispatch<React.SetStateAction<UploadState>>
  ) => {
    e.preventDefault()
    const dropped = Array.from(e.dataTransfer.files)
    setter({ files: dropped, dragging: false })
  }

  const handleFiles = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<UploadState>>
  ) => {
    const picked = Array.from(e.target.files || [])
    setter({ files: picked, dragging: false })
  }

  const removeFile = (
    index: number,
    state: UploadState,
    setter: React.Dispatch<React.SetStateAction<UploadState>>
  ) => {
    const updated = state.files.filter((_, i) => i !== index)
    setter({ ...state, files: updated })
  }

  const allReady =
    input1.files.length > 0 &&
    input2.files.length > 0 &&
    input3.files.length > 0

  const handleAnalyse = async () => {
    if (!allReady) return
    setAnalysing(true)
    setError('')

    const form = new FormData()
    input1.files.forEach(f => form.append('input1', f))
    input2.files.forEach(f => form.append('input2', f))
    input3.files.forEach(f => form.append('input3', f))

    try {
      const res = await fetch('/api/analyse', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Analysis failed')
      const data = await res.json()
      // Store result and navigate to results page
      sessionStorage.setItem('qai_result', JSON.stringify(data))
      window.location.href = '/results'
    } catch (err) {
      setError('Something went wrong. Please check your files and try again.')
      setAnalysing(false)
    }
  }

  return (
    <main className="qai-main">
      <header className="qai-header">
        <div className="qai-logo">
          <span className="logo-q">Q</span>
          <span className="logo-ai">Ai</span>
        </div>
        <div className="qai-tagline">Steel Detailing QA — Automated</div>
      </header>

      <section className="qai-intro">
        <h1>Upload your project files</h1>
        <p>QAi reads your specification documents, 3D model report, and fabrication outputs — then surfaces every discrepancy before steel leaves the shop.</p>
      </section>

      <div className="inputs-grid">
        <DropZone
          label="Input 1"
          title="Project Documents"
          description="Scope sheet, design drawings, RFIs, specifications, codes, emails, MOM and other project references"
          accept=".pdf,.doc,.docx,.txt,.eml,.msg"
          state={input1}
          setter={setInput1}
          inputRef={ref1}
          onDrop={e => handleDrop(e, setInput1)}
          onRemove={(i) => removeFile(i, input1, setInput1)}
          onChange={e => handleFiles(e, setInput1)}
          color="blue"
          icon="📄"
        />

        <DropZone
          label="Input 2"
          title="Tekla Model Report"
          description="Excel or CSV exported from Tekla Structures using the QAi report template — member data, sections, grades, coordinates"
          accept=".xlsx,.xls,.csv"
          state={input2}
          setter={setInput2}
          inputRef={ref2}
          onDrop={e => handleDrop(e, setInput2)}
          onRemove={(i) => removeFile(i, input2, setInput2)}
          onChange={e => handleFiles(e, setInput2)}
          color="teal"
          icon="📊"
        />

        <DropZone
          label="Input 3"
          title="Fabrication Outputs"
          description="Erection drawings, shop drawings, reports, NC files, CNC files and DSTV files from the fabricator"
          accept=".pdf,.nc,.dstv,.cnc,.txt"
          state={input3}
          setter={setInput3}
          inputRef={ref3}
          onDrop={e => handleDrop(e, setInput3)}
          onRemove={(i) => removeFile(i, input3, setInput3)}
          onChange={e => handleFiles(e, setInput3)}
          color="purple"
          icon="🔩"
        />
      </div>

      {error && <div className="qai-error">{error}</div>}

      <div className="qai-action">
        <button
          className={`run-btn ${allReady ? 'ready' : 'waiting'} ${analysing ? 'running' : ''}`}
          onClick={handleAnalyse}
          disabled={!allReady || analysing}
        >
          {analysing ? (
            <>
              <span className="spinner" />
              Analysing project files…
            </>
          ) : (
            <>
              {allReady ? '⚡ Run QAi Analysis' : 'Upload all 3 inputs to continue'}
            </>
          )}
        </button>
        {allReady && !analysing && (
          <p className="ready-note">
            {input1.files.length + input2.files.length + input3.files.length} files ready · QAi will compare all inputs and list every discrepancy
          </p>
        )}
      </div>

      <style jsx>{`
        .qai-main {
          min-height: 100vh;
          background: #0a0e1a;
          color: #e8eaf0;
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          padding: 0 0 80px;
        }
        .qai-header {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 28px 48px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .qai-logo {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -1px;
        }
        .logo-q {
          color: #4a9eff;
        }
        .logo-ai {
          color: #e8eaf0;
        }
        .qai-tagline {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.35);
          padding-left: 16px;
          border-left: 1px solid rgba(255,255,255,0.12);
        }
        .qai-intro {
          max-width: 680px;
          margin: 56px auto 48px;
          padding: 0 24px;
          text-align: center;
        }
        .qai-intro h1 {
          font-size: 32px;
          font-weight: 600;
          letter-spacing: -0.5px;
          margin: 0 0 14px;
          color: #f0f2f8;
        }
        .qai-intro p {
          font-size: 15px;
          line-height: 1.7;
          color: rgba(255,255,255,0.45);
          margin: 0;
        }
        .inputs-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 24px;
        }
        @media (max-width: 900px) {
          .inputs-grid { grid-template-columns: 1fr; }
          .qai-header { padding: 20px 24px; }
        }
        .qai-action {
          max-width: 1100px;
          margin: 32px auto 0;
          padding: 0 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .run-btn {
          width: 100%;
          max-width: 480px;
          padding: 18px 32px;
          border-radius: 12px;
          border: none;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: all 0.2s;
          letter-spacing: -0.2px;
        }
        .run-btn.waiting {
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.3);
          cursor: not-allowed;
          border: 1px solid rgba(255,255,255,0.08);
        }
        .run-btn.ready {
          background: linear-gradient(135deg, #4a9eff, #3a7de0);
          color: white;
          box-shadow: 0 4px 24px rgba(74,158,255,0.35);
        }
        .run-btn.ready:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 32px rgba(74,158,255,0.45);
        }
        .run-btn.running {
          background: rgba(74,158,255,0.15);
          color: #4a9eff;
          border: 1px solid rgba(74,158,255,0.3);
          cursor: wait;
        }
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(74,158,255,0.3);
          border-top-color: #4a9eff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .ready-note {
          font-size: 12px;
          color: rgba(255,255,255,0.35);
          margin: 0;
          text-align: center;
        }
        .qai-error {
          max-width: 480px;
          margin: 16px auto 0;
          padding: 12px 16px;
          background: rgba(255, 80, 80, 0.1);
          border: 1px solid rgba(255,80,80,0.25);
          border-radius: 8px;
          color: #ff8080;
          font-size: 13px;
          text-align: center;
        }
      `}</style>
    </main>
  )
}

type DropZoneProps = {
  label: string
  title: string
  description: string
  accept: string
  state: UploadState
  setter: React.Dispatch<React.SetStateAction<UploadState>>
  inputRef: React.RefObject<HTMLInputElement>
  onDrop: (e: React.DragEvent) => void
  onRemove: (i: number) => void
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  color: 'blue' | 'teal' | 'purple'
  icon: string
}

function DropZone({ label, title, description, accept, state, inputRef, onDrop, onRemove, onChange, color, icon }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)

  const colors = {
    blue:   { accent: '#4a9eff', bg: 'rgba(74,158,255,0.06)',  border: 'rgba(74,158,255,0.2)'  },
    teal:   { accent: '#2dd4a0', bg: 'rgba(45,212,160,0.06)',  border: 'rgba(45,212,160,0.2)'  },
    purple: { accent: '#a78bfa', bg: 'rgba(167,139,250,0.06)', border: 'rgba(167,139,250,0.2)' },
  }
  const c = colors[color]

  return (
    <div
      className={`drop-zone ${dragging ? 'drag-over' : ''} ${state.files.length > 0 ? 'has-files' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { setDragging(false); onDrop(e) }}
      onClick={() => state.files.length === 0 && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        style={{ display: 'none' }}
        onChange={onChange}
      />

      <div className="zone-label">{label}</div>
      <div className="zone-icon">{icon}</div>
      <div className="zone-title">{title}</div>
      <div className="zone-desc">{description}</div>

      {state.files.length === 0 ? (
        <div className="zone-cta">
          <span>Drop files here or click to browse</span>
          <div className="zone-accept">{accept.split(',').join('  ·  ')}</div>
        </div>
      ) : (
        <div className="file-list">
          {state.files.map((f, i) => (
            <div key={i} className="file-item">
              <span className="file-name">{f.name}</span>
              <span className="file-size">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                className="file-remove"
                onClick={e => { e.stopPropagation(); onRemove(i) }}
              >×</button>
            </div>
          ))}
          <button
            className="add-more"
            onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
          >+ Add more files</button>
        </div>
      )}

      <style jsx>{`
        .drop-zone {
          background: rgba(255,255,255,0.03);
          border: 1.5px dashed rgba(255,255,255,0.1);
          border-radius: 16px;
          padding: 28px 24px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 320px;
        }
        .drop-zone:hover, .drop-zone.drag-over {
          background: ${c.bg};
          border-color: ${c.border};
          border-style: solid;
        }
        .drop-zone.has-files {
          background: ${c.bg};
          border-color: ${c.border};
          border-style: solid;
          cursor: default;
        }
        .zone-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: ${c.accent};
        }
        .zone-icon {
          font-size: 28px;
          line-height: 1;
        }
        .zone-title {
          font-size: 16px;
          font-weight: 600;
          color: #f0f2f8;
          letter-spacing: -0.2px;
        }
        .zone-desc {
          font-size: 12px;
          line-height: 1.6;
          color: rgba(255,255,255,0.38);
        }
        .zone-cta {
          margin-top: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .zone-cta span {
          font-size: 13px;
          color: rgba(255,255,255,0.4);
        }
        .zone-accept {
          font-size: 10px;
          color: rgba(255,255,255,0.2);
          font-family: monospace;
          letter-spacing: 0.05em;
        }
        .file-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 8px;
        }
        .file-item {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.05);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
        }
        .file-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #e8eaf0;
        }
        .file-size {
          color: rgba(255,255,255,0.3);
          white-space: nowrap;
        }
        .file-remove {
          background: none;
          border: none;
          color: rgba(255,255,255,0.3);
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 0 2px;
          transition: color 0.15s;
        }
        .file-remove:hover { color: #ff8080; }
        .add-more {
          background: none;
          border: 1px dashed rgba(255,255,255,0.15);
          border-radius: 8px;
          color: rgba(255,255,255,0.35);
          font-size: 12px;
          padding: 7px;
          cursor: pointer;
          transition: all 0.15s;
          text-align: center;
        }
        .add-more:hover {
          border-color: ${c.border};
          color: ${c.accent};
        }
      `}</style>
    </div>
  )
}
