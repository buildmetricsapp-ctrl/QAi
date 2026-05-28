'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────────────────────────
type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR';
type Status = 'PASS' | 'REVIEW REQUIRED' | 'FAIL';

interface Discrepancy {
  id: string;
  severity: Severity;
  category: string;
  member_mark: string;
  description: string;
  input1_says: string;
  input2_says: string;
  input3_says: string;
  recommended_action: string;
}

interface ProjectSummary {
  project_name?: string;
  revision?: string;
  status: Status;
  total_members?: number;
  total_weight?: string;
  critical_count: number;
  major_count: number;
  minor_count: number;
  summary_notes?: string;
}

interface QAiResult {
  project_summary: ProjectSummary;
  discrepancies: Discrepancy[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const SEV_CONFIG: Record<Severity, { label: string; color: string; bg: string; ring: string; dot: string }> = {
  CRITICAL: { label: 'CRITICAL', color: '#ff4d4d', bg: 'rgba(255,77,77,0.08)', ring: 'rgba(255,77,77,0.3)', dot: '#ff4d4d' },
  MAJOR:    { label: 'MAJOR',    color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', ring: 'rgba(245,158,11,0.3)', dot: '#f59e0b' },
  MINOR:    { label: 'MINOR',    color: '#38bdf8', bg: 'rgba(56,189,248,0.08)', ring: 'rgba(56,189,248,0.3)', dot: '#38bdf8' },
};

const STATUS_CONFIG: Record<Status, { color: string; bg: string; border: string; icon: string }> = {
  'PASS':             { color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.3)', icon: '✓' },
  'REVIEW REQUIRED':  { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', icon: '⚠' },
  'FAIL':             { color: '#ff4d4d', bg: 'rgba(255,77,77,0.08)',   border: 'rgba(255,77,77,0.3)',   icon: '✗' },
};

// ── MOCK DATA for dev/demo (remove for production) ────────────────────────────
const MOCK: QAiResult = {
  project_summary: {
    project_name: 'Warehouse Extension — Block C',
    revision: 'Rev 3',
    status: 'REVIEW REQUIRED',
    total_members: 214,
    total_weight: '187.4 T',
    critical_count: 2,
    major_count: 5,
    minor_count: 11,
    summary_notes: 'Two critical discrepancies found in primary column grid. Major grade mismatch on mezzanine beams requires immediate engineer review before fabrication proceeds.',
  },
  discrepancies: [
    { id: 'D001', severity: 'CRITICAL', category: 'Profile', member_mark: 'C1A', description: 'Column profile does not match design drawing specification', input1_says: '310UC158 Grade 350', input2_says: '250UC89 Grade 350', input3_says: '250UC89 Grade 350', recommended_action: 'Update Tekla model to 310UC158 and reissue all affected drawings. Notify engineer.' },
    { id: 'D002', severity: 'CRITICAL', category: 'Grade', member_mark: 'MB-03', description: 'Steel grade mismatch on primary mezzanine beam — model and drawings show lower grade than specification', input1_says: 'Grade 350', input2_says: 'Grade 300', input3_says: 'Grade 300', recommended_action: 'Reconfirm with engineer via RFI. Do not fabricate until resolved.' },
    { id: 'D003', severity: 'MAJOR', category: 'Length', member_mark: 'RB-07', description: 'Rafter beam length differs by 45mm between model and erection drawing', input1_says: 'Not specified', input2_says: '9850mm', input3_says: '9805mm', recommended_action: 'Check grid coordinates in model and confirm with design drawing. Reissue NC file.' },
    { id: 'D004', severity: 'MAJOR', category: 'Bolt Spec', member_mark: 'BP-12', description: 'Base plate bolt group specification inconsistent', input1_says: '8×M24 Grade 8.8 HDG', input2_says: '8×M24 Grade 4.6', input3_says: '8×M24 Grade 8.8', recommended_action: 'Update bolt spec in Tekla model to Grade 8.8 HDG per specification. Reissue shop drawing.' },
    { id: 'D005', severity: 'MAJOR', category: 'Surface Treatment', member_mark: 'PL-04', description: 'Platform grating specified as galvanised in project spec, shown as painted in shop drawing', input1_says: 'Hot dip galvanised', input2_says: 'Painted — 2 coat epoxy', input3_says: 'Painted — 2 coat epoxy', recommended_action: 'Clarify with client. If galvanised, update model UDA and reissue drawing.' },
    { id: 'D006', severity: 'MAJOR', category: 'Weld', member_mark: 'EC-01', description: 'End plate weld size differs from WPS requirement', input1_says: '8mm fillet weld (E48XX)', input2_says: '6mm fillet weld', input3_says: '6mm fillet weld', recommended_action: 'Update weld specification in Tekla and reissue shop drawing and NC files.' },
    { id: 'D007', severity: 'MAJOR', category: 'Phase', member_mark: 'SB-09', description: 'Secondary beam assigned to Phase 2 in model, Phase 1 in erection drawing', input1_says: 'Not specified', input2_says: 'Phase 2', input3_says: 'Phase 1', recommended_action: 'Confirm phasing with project manager. Update model and reissue drawing.' },
    { id: 'D008', severity: 'MINOR', category: 'Coordinates', member_mark: 'C3B', description: 'Column start Z coordinate offset by 2mm — within tolerance but noted', input1_says: 'FL +0.000', input2_says: 'Z = 0.000', input3_says: 'Z = -0.002', recommended_action: 'Monitor during erection. No action required unless outside site tolerance.' },
    { id: 'D009', severity: 'MINOR', category: 'Drawing Number', member_mark: 'KB-11', description: 'Drawing number in shop drawing header does not match document register', input1_says: 'QAi-SD-011 Rev B', input2_says: 'QAi-SD-011', input3_says: 'QAi-SD-11 Rev B', recommended_action: 'Update drawing number format for consistency. Reissue as admin revision.' },
    { id: 'D010', severity: 'MINOR', category: 'Erection Mark', member_mark: 'RB-12', description: 'Erection mark missing from erection drawing for this member', input1_says: 'Not referenced', input2_says: 'EMARK: RB-12', input3_says: 'Not shown', recommended_action: 'Add erection mark to erection drawing. Minor drawing update.' },
  ],
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const router = useRouter();
  const [result, setResult] = useState<QAiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSev, setActiveSev] = useState<Severity | 'ALL'>('ALL');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchMark, setSearchMark] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('qai_result');
      if (raw) {
        setResult(JSON.parse(raw));
      } else {
        // Fall back to mock for demo
        setResult(MOCK);
      }
    } catch (e) {
      console.error('Results parse error:', e)
      setResult(MOCK);
    }
    setLoading(false);
  }, []);

  const categories = result
    ? ['ALL', ...Array.from(new Set(result.discrepancies.map(d => d.category))).sort()]
    : ['ALL'];

  const filtered = (result?.discrepancies ?? []).filter(d => {
    const sevOk = activeSev === 'ALL' || d.severity === activeSev;
    const catOk = activeCategory === 'ALL' || d.category === activeCategory;
    const markOk = !searchMark || d.member_mark.toLowerCase().includes(searchMark.toLowerCase());
    return sevOk && catOk && markOk;
  });

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(filtered.map(d => d.id)));
  const collapseAll = () => setExpanded(new Set());

  // ── Export to CSV / Excel ─────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    if (!result) return;
    setExporting(true);
    const headers = ['ID', 'Severity', 'Category', 'Member Mark', 'Description', 'Input 1 (Project Docs)', 'Input 2 (Tekla Model)', 'Input 3 (Fab Output)', 'Recommended Action'];
    const rows = result.discrepancies.map(d => [
      d.id, d.severity, d.category, d.member_mark,
      `"${d.description}"`, `"${d.input1_says}"`, `"${d.input2_says}"`, `"${d.input3_says}"`, `"${d.recommended_action}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QAi_Report_${result.project_summary.project_name ?? 'Project'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setTimeout(() => setExporting(false), 800);
  }, [result]);

  // ── Print / PDF ───────────────────────────────────────────────────────────
  const printReport = () => window.print();

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Loading QAi Report…</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div style={styles.loadingScreen}>
        <p style={{ color: '#ff4d4d', fontFamily: 'monospace', fontSize: 16 }}>No result data found. Please run an analysis first.</p>
        <button style={styles.backBtn} onClick={() => router.push('/')}>← Back to Upload</button>
      </div>
    );
  }

  const ps = result?.project_summary ?? {};
  const stCfg = STATUS_CONFIG[ps.status];
  const total = ps.critical_count + ps.major_count + ps.minor_count;

  return (
    <>
      {/* ── Print styles injected globally ─────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@400;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080c14; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 var(--ring-c); }
          50%       { box-shadow: 0 0 0 6px transparent; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }

        .disc-card {
          animation: fadeUp 0.35s ease both;
        }
        .disc-card:hover {
          transform: translateY(-1px);
          transition: transform 0.15s ease;
        }
        .filter-btn {
          transition: all 0.15s ease;
        }
        .filter-btn:hover {
          opacity: 0.85;
        }
        .sev-badge {
          animation: pulse-ring 2.5s ease infinite;
        }

        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-page { background: #fff !important; color: #000 !important; padding: 20px !important; }
          .disc-card { break-inside: avoid; border: 1px solid #ccc !important; background: #f9f9f9 !important; margin-bottom: 12px !important; }
        }
      `}</style>

      <div ref={printRef} style={styles.page} className="print-page">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header style={styles.header} className="no-print">
          <div style={styles.headerInner}>
            <div style={styles.logoGroup}>
              <span style={styles.logoQ}>QA</span>
              <span style={styles.logoI}>i</span>
              <span style={styles.logoSub}>Steel Detailing QA</span>
            </div>
            <div style={styles.headerActions}>
  <Link href="/dashboard" style={{
    background: 'transparent',
    color: '#00ff9d',
    border: '1px solid #00ff9d',
    padding: '0.5rem 1.25rem',
    borderRadius: '6px',
    textDecoration: 'none',
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 700,
    fontSize: '0.8rem',
    marginRight: '0.5rem',
  }}>
    Dashboard
  </Link>
  <button style={{ ...styles.iconBtn, ...styles.printBtn }} onClick={printReport} title="Print / Save PDF">
    🖨 Print / PDF
  </button>
              <button
                style={{ ...styles.iconBtn, ...styles.exportBtn, opacity: exporting ? 0.6 : 1 }}
                onClick={exportCSV}
                title="Export to CSV"
              >
                {exporting ? '⏳ Exporting…' : '📊 Export CSV'}
              </button>
              <button style={styles.newAnalysisBtn} onClick={() => router.push('/')}>
                ← New Analysis
              </button>
            </div>
          </div>
        </header>

        {/* ── Status Banner ───────────────────────────────────────────────── */}
        <section style={{ ...styles.statusBanner, background: stCfg.bg, borderColor: stCfg.border }}>
          <div style={styles.statusLeft}>
            <span style={{ ...styles.statusIcon, color: stCfg.color }}>{stCfg.icon}</span>
            <div>
              <div style={{ ...styles.statusLabel, color: stCfg.color }}>{ps.status}</div>
              <div style={styles.projectName}>{ps.project_name ?? 'Steel Project'}</div>
              {ps.revision && <div style={styles.revisionTag}>{ps.revision}</div>}
            </div>
          </div>
          <div style={styles.statusRight}>
            {ps.total_members && (
              <StatChip label="Members" value={ps.total_members.toString()} />
            )}
            {ps.total_weight && (
              <StatChip label="Total Weight" value={ps.total_weight} />
            )}
            <StatChip label="Issues" value={total.toString()} />
          </div>
        </section>

        {/* ── Summary Notes ──────────────────────────────────────────────── */}
        {ps.summary_notes && (
          <div style={styles.summaryNote}>
            <span style={styles.noteIcon}>📋</span>
            <p style={styles.noteText}>{ps.summary_notes}</p>
          </div>
        )}

        {/* ── Severity Counters ──────────────────────────────────────────── */}
        <div style={styles.sevRow}>
          {(['CRITICAL', 'MAJOR', 'MINOR'] as Severity[]).map(s => {
            const cfg = SEV_CONFIG[s];
            const count = s === 'CRITICAL' ? ps.critical_count : s === 'MAJOR' ? ps.major_count : ps.minor_count;
            return (
              <div
                key={s}
                style={{
                  ...styles.sevCard,
                  background: cfg.bg,
                  borderColor: cfg.ring,
                  cursor: 'pointer',
                  outline: activeSev === s ? `2px solid ${cfg.color}` : 'none',
                }}
                onClick={() => setActiveSev(prev => prev === s ? 'ALL' : s)}
              >
                <div style={{ ...styles.sevCount, color: cfg.color }}>{count}</div>
                <div style={{ ...styles.sevLabel, color: cfg.color }}>{s}</div>
                <div style={styles.sevSublabel}>issue{count !== 1 ? 's' : ''}</div>
              </div>
            );
          })}
        </div>

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div style={styles.filtersRow} className="no-print">
          {/* Severity filter pills */}
          <div style={styles.filterGroup}>
            {(['ALL', 'CRITICAL', 'MAJOR', 'MINOR'] as const).map(s => {
              const isActive = activeSev === s;
              const cfg = s !== 'ALL' ? SEV_CONFIG[s] : null;
              return (
                <button
                  key={s}
                  className="filter-btn"
                  style={{
                    ...styles.pill,
                    background: isActive ? (cfg?.color ?? '#6366f1') : 'rgba(255,255,255,0.05)',
                    color: isActive ? '#000' : '#9ca3af',
                    borderColor: cfg?.color ?? 'transparent',
                  }}
                  onClick={() => setActiveSev(s)}
                >
                  {s}
                </button>
              );
            })}
          </div>

          {/* Category dropdown */}
          <select
            style={styles.catSelect}
            value={activeCategory}
            onChange={e => setActiveCategory(e.target.value)}
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Mark search */}
          <input
            type="text"
            placeholder="Search mark…"
            style={styles.markSearch}
            value={searchMark}
            onChange={e => setSearchMark(e.target.value)}
          />

          {/* Expand / Collapse */}
          <div style={styles.expandControls}>
            <button style={styles.miniBtn} onClick={expandAll}>Expand all</button>
            <button style={styles.miniBtn} onClick={collapseAll}>Collapse all</button>
          </div>
        </div>

        {/* ── Results count ─────────────────────────────────────────────── */}
        <div style={styles.resultsCount}>
          Showing <strong style={{ color: '#e2e8f0' }}>{filtered.length}</strong> of {result.discrepancies.length} discrepancies
        </div>

        {/* ── Discrepancy Cards ──────────────────────────────────────────── */}
        <div style={styles.cardList}>
          {filtered.length === 0 && (
            <div style={styles.emptyState}>No discrepancies match the current filters.</div>
          )}
          {filtered.map((d, i) => {
            const cfg = SEV_CONFIG[d.severity];
            const isOpen = expanded.has(d.id);
            return (
              <div
                key={d.id}
                className="disc-card"
                style={{
                  ...styles.card,
                  borderColor: cfg.ring,
                  animationDelay: `${i * 40}ms`,
                }}
              >
                {/* Card Header */}
                <div
                  style={styles.cardHeader}
                  onClick={() => toggleExpand(d.id)}
                >
                  <div style={styles.cardHeaderLeft}>
                    {/* Severity badge */}
                    <span
                      className="sev-badge"
                      style={{
                        ...styles.badge,
                        background: cfg.bg,
                        color: cfg.color,
                        '--ring-c': cfg.ring,
                      } as React.CSSProperties}
                    >
                      {d.severity}
                    </span>
                    {/* ID + Mark */}
                    <span style={styles.cardId}>{d.id}</span>
                    <span style={styles.cardMark}>
                      <span style={styles.markDot} />
                      {d.member_mark}
                    </span>
                    {/* Category tag */}
                    <span style={styles.catTag}>{d.category}</span>
                  </div>
                  <div style={styles.cardHeaderRight}>
                    <span style={styles.cardDesc}>{d.description}</span>
                    <span style={{ ...styles.chevron, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                  </div>
                </div>

                {/* Card Body (expanded) */}
                {isOpen && (
                  <div style={styles.cardBody}>
                    <div style={styles.inputGrid}>
                      <InputCell label="📄 Input 1 — Project Docs" value={d.input1_says} color="#a78bfa" />
                      <InputCell label="🏗 Input 2 — Tekla Model"  value={d.input2_says} color="#38bdf8" />
                      <InputCell label="🔩 Input 3 — Fab Output"   value={d.input3_says} color="#34d399" />
                    </div>
                    <div style={styles.actionRow}>
                      <span style={styles.actionIcon}>⚡</span>
                      <div>
                        <div style={styles.actionLabel}>Recommended Action</div>
                        <div style={styles.actionText}>{d.recommended_action}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer style={styles.footer} className="no-print">
          <span style={styles.footerText}>QAi • Steel Detailing QA • Powered by Claude AI</span>
          <span style={styles.footerDate}>Report generated {new Date().toLocaleString()}</span>
        </footer>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.statChip}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function InputCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ ...styles.inputCell, borderColor: color + '44' }}>
      <div style={{ ...styles.inputCellLabel, color }}>{label}</div>
      <div style={styles.inputCellValue}>{value}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  // ─── Layout ────────────────────────────────────────────────────────────────
  page: {
    minHeight: '100vh',
    background: '#080c14',
    color: '#cbd5e1',
    fontFamily: "'Syne', 'IBM Plex Mono', sans-serif",
    paddingBottom: 80,
  },
  loadingScreen: {
    minHeight: '100vh',
    background: '#080c14',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid rgba(99,102,241,0.2)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    color: '#6b7280',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
  },

  // ─── Header ────────────────────────────────────────────────────────────────
  header: {
    background: 'rgba(8,12,20,0.95)',
    borderBottom: '1px solid rgba(99,102,241,0.15)',
    backdropFilter: 'blur(12px)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: 1280,
    margin: '0 auto',
    padding: '14px 28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoGroup: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  logoQ: {
    fontFamily: "'Syne', sans-serif",
    fontWeight: 800,
    fontSize: 22,
    color: '#818cf8',
    letterSpacing: '-0.5px',
  },
  logoI: {
    fontFamily: "'Syne', sans-serif",
    fontWeight: 800,
    fontSize: 22,
    color: '#38bdf8',
  },
  logoSub: {
    fontSize: 11,
    color: '#4b5563',
    fontFamily: "'IBM Plex Mono', monospace",
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: 6,
  },
  headerActions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  iconBtn: {
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#94a3b8',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  printBtn: {},
  exportBtn: {},
  newAnalysisBtn: {
    padding: '7px 16px',
    borderRadius: 8,
    border: '1px solid rgba(99,102,241,0.4)',
    background: 'rgba(99,102,241,0.1)',
    color: '#818cf8',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    cursor: 'pointer',
  },
  backBtn: {
    marginTop: 16,
    padding: '8px 20px',
    borderRadius: 8,
    border: '1px solid #6366f1',
    background: 'transparent',
    color: '#818cf8',
    cursor: 'pointer',
  },

  // ─── Status Banner ─────────────────────────────────────────────────────────
  statusBanner: {
    maxWidth: 1280,
    margin: '28px auto 0',
    marginLeft: 'auto',
    marginRight: 'auto',
    padding: '24px 32px',
    borderRadius: 14,
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 20,
    width: 'calc(100% - 56px)',
    animation: 'fadeUp 0.4s ease',
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  statusIcon: {
    fontSize: 48,
    lineHeight: 1,
    fontWeight: 700,
  },
  statusLabel: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: '-0.5px',
  },
  projectName: {
    fontSize: 15,
    color: '#94a3b8',
    marginTop: 2,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  revisionTag: {
    display: 'inline-block',
    marginTop: 6,
    padding: '2px 8px',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    fontSize: 11,
    color: '#6b7280',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  statusRight: {
    display: 'flex',
    gap: 16,
  },
  statChip: {
    textAlign: 'center' as const,
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.06)',
    minWidth: 90,
  },
  statValue: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 22,
    fontWeight: 700,
    color: '#e2e8f0',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontFamily: "'IBM Plex Mono', monospace",
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // ─── Summary Note ──────────────────────────────────────────────────────────
  summaryNote: {
    maxWidth: 1280,
    margin: '16px auto 0',
    width: 'calc(100% - 56px)',
    padding: '14px 20px',
    background: 'rgba(99,102,241,0.06)',
    borderRadius: 10,
    border: '1px solid rgba(99,102,241,0.15)',
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
  },
  noteIcon: { fontSize: 18, flexShrink: 0 },
  noteText: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 1.6,
    fontFamily: "'IBM Plex Mono', monospace",
  },

  // ─── Severity Row ──────────────────────────────────────────────────────────
  sevRow: {
    maxWidth: 1280,
    margin: '20px auto 0',
    width: 'calc(100% - 56px)',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 14,
  },
  sevCard: {
    padding: '18px 24px',
    borderRadius: 12,
    border: '1px solid',
    textAlign: 'center' as const,
    transition: 'all 0.2s',
  },
  sevCount: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 40,
    fontWeight: 800,
    lineHeight: 1,
  },
  sevLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 2,
    marginTop: 4,
  },
  sevSublabel: {
    fontSize: 11,
    color: '#4b5563',
    marginTop: 2,
  },

  // ─── Filters ───────────────────────────────────────────────────────────────
  filtersRow: {
    maxWidth: 1280,
    margin: '20px auto 0',
    width: 'calc(100% - 56px)',
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  filterGroup: { display: 'flex', gap: 6 },
  pill: {
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid',
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: 0.5,
  },
  catSelect: {
    padding: '7px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    cursor: 'pointer',
    outline: 'none',
  },
  markSearch: {
    padding: '7px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    outline: 'none',
    width: 160,
  },
  expandControls: { display: 'flex', gap: 8, marginLeft: 'auto' },
  miniBtn: {
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'transparent',
    color: '#6b7280',
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
    cursor: 'pointer',
  },

  // ─── Results count ─────────────────────────────────────────────────────────
  resultsCount: {
    maxWidth: 1280,
    margin: '12px auto 0',
    width: 'calc(100% - 56px)',
    fontSize: 12,
    color: '#4b5563',
    fontFamily: "'IBM Plex Mono', monospace",
  },

  // ─── Cards ─────────────────────────────────────────────────────────────────
  cardList: {
    maxWidth: 1280,
    margin: '12px auto 0',
    width: 'calc(100% - 56px)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  card: {
    background: 'rgba(15,21,36,0.8)',
    borderRadius: 12,
    border: '1px solid',
    overflow: 'hidden',
    backdropFilter: 'blur(8px)',
    transition: 'transform 0.15s ease',
  },
  cardHeader: {
    padding: '14px 18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    cursor: 'pointer',
    flexWrap: 'wrap',
  },
  cardHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  cardHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    justifyContent: 'flex-end',
  },
  badge: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 600,
    letterSpacing: 1,
    flexShrink: 0,
  },
  cardId: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: '#4b5563',
  },
  cardMark: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    fontWeight: 600,
    color: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  markDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#6366f1',
    display: 'inline-block',
  },
  catTag: {
    padding: '2px 8px',
    borderRadius: 4,
    background: 'rgba(99,102,241,0.1)',
    color: '#818cf8',
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    letterSpacing: 0.5,
  },
  cardDesc: {
    fontSize: 13,
    color: '#94a3b8',
    flex: 1,
    textAlign: 'right' as const,
  },
  chevron: {
    fontSize: 16,
    color: '#4b5563',
    transition: 'transform 0.2s ease',
    flexShrink: 0,
  },

  // ─── Card Body ─────────────────────────────────────────────────────────────
  cardBody: {
    padding: '0 18px 18px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    marginTop: 0,
    paddingTop: 16,
  },
  inputGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    marginBottom: 16,
  },
  inputCell: {
    padding: '12px 14px',
    borderRadius: 8,
    border: '1px solid',
    background: 'rgba(255,255,255,0.02)',
  },
  inputCellLabel: {
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 600,
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
  },
  inputCellValue: {
    fontSize: 13,
    color: '#e2e8f0',
    fontFamily: "'IBM Plex Mono', monospace",
    lineHeight: 1.5,
  },
  actionRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    padding: '12px 14px',
    borderRadius: 8,
    background: 'rgba(245,158,11,0.04)',
    border: '1px solid rgba(245,158,11,0.12)',
  },
  actionIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  actionLabel: {
    fontSize: 10,
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#d97706',
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  actionText: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 1.55,
  },

  emptyState: {
    textAlign: 'center' as const,
    padding: 60,
    color: '#374151',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
  },

  // ─── Footer ────────────────────────────────────────────────────────────────
  footer: {
    maxWidth: 1280,
    margin: '48px auto 0',
    width: 'calc(100% - 56px)',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    paddingTop: 20,
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#374151',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  footerText: {},
  footerDate: { color: '#1f2937' },
};
