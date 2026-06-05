import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import JSZip from 'jszip'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_PDF_PAGES = 5    // pages to extract per PDF
const BATCH_SIZE    = 5    // files per Claude call (keep memory low)
const TEXT_LIMIT    = 2000 // chars per file sent to Claude

// ─── PDF Text Extraction ──────────────────────────────────────────────────────
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  // Try pdftotext first (handles complex fonts better than pdf2json)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process') as typeof import('child_process')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('os') as typeof import('os')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')

    const tmpFile = path.join(os.tmpdir(), `qai_${Date.now()}.pdf`)
    fs.writeFileSync(tmpFile, Buffer.from(buffer))

    try {
      const text = execSync(`pdftotext -l ${MAX_PDF_PAGES} "${tmpFile}" -`, {
        timeout: 15000,
        maxBuffer: 1024 * 1024 * 10,
      }).toString()

      fs.unlinkSync(tmpFile)

      if (text && text.trim().length > 50) {
        return text.slice(0, TEXT_LIMIT * 3) // give pdftotext more room
      }
    } catch {
      fs.unlinkSync(tmpFile)
    }
  } catch { /* fall through to pdf2json */ }

  // Fallback to pdf2json
  return new Promise((resolve) => {
    try {
      const PDFParser = require('pdf2json')
      const parser = new PDFParser()
      parser.on('pdfParser_dataReady', (data: any) => {
        try {
          const pages = data.Pages?.slice(0, MAX_PDF_PAGES) ?? []
          const text = pages.map((page: any, i: number) => {
            const pageText = (page.Texts ?? [])
              .map((t: any) => (t.R ?? []).map((r: any) => decodeURIComponent(r.T ?? '')).join('')).filter(Boolean).join(' ')
            return `[Page ${i + 1}]\n${pageText}`
          }).join('\n\n')
          resolve(text || '[PDF parsed but no text found]')
        } catch { resolve('[PDF parse error]') }
      })
      parser.on('pdfParser_dataError', () => resolve('[PDF could not be parsed]'))
      parser.parseBuffer(Buffer.from(buffer))
    } catch { resolve('[PDF extraction unavailable]') }
  })
}

// ─── ZIP Entry Types ──────────────────────────────────────────────────────────
// Lazy entry — getData() only called when we actually process this file
// This means ZIP contents are never all in RAM at once

type ZipEntry = {
  name: string
  getData: () => Promise<ArrayBuffer>
}

const ALLOWED_EXTS = ['.pdf', '.nc', '.dstv', '.csv', '.txt']

async function getZipEntries(zipFile: File): Promise<ZipEntry[]> {
  const buf = await zipFile.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const entries: ZipEntry[] = []

  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const lower = filename.toLowerCase()
    if (!ALLOWED_EXTS.some(ext => lower.endsWith(ext))) continue
    const shortName = filename.split('/').pop() || filename
    entries.push({
      name: shortName,
      getData: () => entry.async('arraybuffer'),
    })
  }

  return entries
}

async function getFileEntries(files: File[]): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      entries.push(...await getZipEntries(f))
    } else {
      entries.push({
        name: f.name,
        getData: () => f.arrayBuffer(),
      })
    }
  }
  return entries
}

// ─── Read Entries to Text ─────────────────────────────────────────────────────
// Reads only the given entries (a small batch) — never the whole set at once

async function readEntriesToText(entries: ZipEntry[], label: string): Promise<string> {
  if (entries.length === 0) return ''
  const parts: string[] = []

  for (const entry of entries) {
    const buf  = await entry.getData()
    const name = entry.name.toLowerCase()
    let content: string

    if (name.endsWith('.pdf')) {
      const text = await extractPdfText(buf)
      content = `[PDF: ${entry.name}]\n${text}`
    } else {
      try {
        content = new TextDecoder('utf-8').decode(buf)
      } catch {
        content = `[Binary file: ${entry.name}]`
      }
    }

    parts.push(`--- ${label} FILE: ${entry.name} ---\n${content.slice(0, TEXT_LIMIT)}`)
  }

  return parts.join('\n\n')
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────
function buildPrompt(
  text1: string,
  text2: string,
  text3: string,
  batchInfo: string,
  providedInputs: string[],
  missingInputs: string[]
): string {
  return `You are QAi — an expert steel detailing quality assurance system.

You have been given inputs from a steel construction project:

INPUT 1 — PROJECT DOCUMENTS (scope sheet, specs, RFIs, codes, emails, MOM):
${text1 || '[NOT PROVIDED]'}

INPUT 2 — TEKLA MODEL REPORT (member data extracted from the 3D model):
${text2 || '[NOT PROVIDED]'}

INPUT 3 — FABRICATION OUTPUTS (shop drawings, erection drawings, NC/DSTV files):
${text3 || '[NOT PROVIDED]'}

${batchInfo}

Your job is to:
1. Compare the provided inputs against each other
2. List every discrepancy — mismatched sections, wrong grades, incorrect dimensions, bolt/weld differences, missing members, surface treatment conflicts, and any other deviations
3. Classify each by severity: CRITICAL (stops fabrication or is unsafe), MAJOR (significant rework needed), MINOR (note for record)
4. Produce a project summary

${missingInputs.length > 0 ? `IMPORTANT: Only ${providedInputs.join(' and ')} were provided. ${missingInputs.join(', ')} was NOT provided. Base your analysis only on the available inputs.` : ''}

Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON:
{
  "project_summary": {
    "project_name": "Name of the project extracted from documents",
    "revision": "Revision number if found e.g. Rev 0",
    "status": "PASS | REVIEW REQUIRED | FAIL",
    "total_members": 0,
    "total_weight": "e.g. 12.4 T",
    "critical_count": 0,
    "major_count": 0,
    "minor_count": 0,
    "input1_files": [],
    "input2_files": [],
    "input3_files": [],
    "summary_notes": "One paragraph plain-English summary of the overall QA result including which inputs were compared"
  },
  "discrepancies": [
    {
      "id": "D001",
      "severity": "CRITICAL | MAJOR | MINOR",
      "category": "Section size | Steel grade | Dimension | Bolt spec | Weld detail | Surface treatment | Missing member | Position | Other",
      "member_mark": "e.g. M201STR8, C1, B2",
      "description": "Plain English description of the discrepancy",
      "input1_says": "What Input 1 shows or N/A if not provided",
      "input2_says": "What Input 2 shows or N/A if not provided",
      "input3_says": "What Input 3 shows or N/A if not provided",
      "recommended_action": "What needs to be corrected and by whom"
    }
  ]
}`
}

// ─── Single Claude Call ───────────────────────────────────────────────────────
async function callClaude(prompt: string): Promise<any> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw   = response.content[0].type === 'text' ? response.content[0].text : ''
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ─── Merge Batch Results ──────────────────────────────────────────────────────
function mergeResults(results: any[]): any {
  if (results.length === 1) return results[0]

  const base = results[0]
  const allDiscrepancies: any[] = []
  let idCounter = 1

  for (const result of results) {
    for (const d of (result.discrepancies ?? [])) {
      allDiscrepancies.push({
        ...d,
        id: `D${String(idCounter++).padStart(3, '0')}`,
      })
    }
  }

  const critical = allDiscrepancies.filter(d => d.severity === 'CRITICAL').length
  const major    = allDiscrepancies.filter(d => d.severity === 'MAJOR').length
  const minor    = allDiscrepancies.filter(d => d.severity === 'MINOR').length
  const total    = allDiscrepancies.length

  let status = 'PASS'
  if (critical > 0) status = 'FAIL'
  else if (major > 0 || minor > 0) status = 'REVIEW REQUIRED'

  const allNotes = results
    .map(r => r.project_summary?.summary_notes)
    .filter(Boolean)
    .join(' | ')

  return {
    project_summary: {
      ...base.project_summary,
      status,
      critical_count: critical,
      major_count:    major,
      minor_count:    minor,
      summary_notes:  total > 0
        ? `${total} discrepancies found across ${results.length} batch(es): ${critical} CRITICAL, ${major} MAJOR, ${minor} MINOR. ${allNotes}`
        : `No discrepancies found across ${results.length} batch(es). ${allNotes}`,
    },
    discrepancies: allDiscrepancies,
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const raw1 = form.getAll('input1') as File[]
    const raw2 = form.getAll('input2') as File[]
    const raw3 = form.getAll('input3') as File[]

    // Get entries (lazy — no file data loaded yet)
    const [entries1, entries2, entries3] = await Promise.all([
      getFileEntries(raw1),
      getFileEntries(raw2),
      getFileEntries(raw3),
    ])

    console.log(`[QAi] Entries — Input1: ${entries1.length}, Input2: ${entries2.length}, Input3: ${entries3.length}`)

    const providedInputs = [
      entries1.length > 0 ? 'Input 1 (Project Documents)' : null,
      entries2.length > 0 ? 'Input 2 (Tekla Model Report)' : null,
      entries3.length > 0 ? 'Input 3 (Fabrication Outputs)' : null,
    ].filter(Boolean) as string[]

    const missingInputs = [
      entries1.length === 0 ? 'Input 1 (Project Documents)' : null,
      entries2.length === 0 ? 'Input 2 (Tekla Model Report)' : null,
      entries3.length === 0 ? 'Input 3 (Fabrication Outputs)' : null,
    ].filter(Boolean) as string[]

    // Input 2 (Tekla report) is usually small — read once
    const text2 = await readEntriesToText(entries2, 'INPUT-2 (Tekla Model Report)')

    // Chunk Input 1 and Input 3 into batches of BATCH_SIZE
    const chunk1s: ZipEntry[][] = []
    for (let i = 0; i < Math.max(entries1.length, 1); i += BATCH_SIZE) {
      chunk1s.push(entries1.slice(i, i + BATCH_SIZE))
    }

    const chunk3s: ZipEntry[][] = []
    for (let i = 0; i < Math.max(entries3.length, 1); i += BATCH_SIZE) {
      chunk3s.push(entries3.slice(i, i + BATCH_SIZE))
    }

    const totalBatches = Math.max(chunk1s.length, chunk3s.length)
    console.log(`[QAi] Input1: ${entries1.length} files → ${chunk1s.length} chunks`)
    console.log(`[QAi] Input3: ${entries3.length} files → ${chunk3s.length} chunks`)
    console.log(`[QAi] Total batches: ${totalBatches}`)

    const batchResults: any[] = []

    for (let i = 0; i < totalBatches; i++) {
      const c1 = chunk1s[i] ?? []
      const c3 = chunk3s[i] ?? []

      console.log(`[QAi] Batch ${i + 1}/${totalBatches} — Input1: [${c1.map(e => e.name).join(', ') || 'none'}] | Input3: [${c3.map(e => e.name).join(', ') || 'none'}]`)

      // Read only this batch's files — previous batch data is GC-eligible
      const [text1, text3] = await Promise.all([
        readEntriesToText(c1, 'INPUT-1 (Project Documents)'),
        readEntriesToText(c3, 'INPUT-3 (Fabrication Outputs)'),
      ])

      const batchInfo = totalBatches > 1
        ? `NOTE: Batch ${i + 1} of ${totalBatches}. Comparing Input 1 files [${c1.map(e => e.name).join(', ') || 'none'}] against Input 3 files [${c3.map(e => e.name).join(', ') || 'none'}]. Focus only on these files.`
        : ''

      const prompt = buildPrompt(text1, text2, text3, batchInfo, providedInputs, missingInputs)
      batchResults.push(await callClaude(prompt))

      // Pause briefly to let GC free memory before next batch
      await new Promise(r => setTimeout(r, 300))
    }

    const result = mergeResults(batchResults)

    // ── Save to Supabase ──────────────────────────────────────────────────────
    try {
      const projectName = result.project_summary?.project_name ?? 'Unnamed Project'

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .upsert({ name: projectName }, { onConflict: 'name' })
        .select()
        .single()

      if (projectError) throw projectError

      const { data: run, error: runError } = await supabase
        .from('runs')
        .insert({
          project_id:    project.id,
          revision:      result.project_summary?.revision      ?? null,
          status:        result.project_summary?.status        ?? null,
          member_count:  result.project_summary?.total_members ?? null,
          total_weight:  parseFloat(result.project_summary?.total_weight ?? '') || null,
          issue_count:   result.discrepancies?.length          ?? 0,
          summary_notes: result.project_summary?.summary_notes ?? null,
        })
        .select()
        .single()

      if (runError) throw runError

      if (result.discrepancies?.length > 0) {
        const rows = result.discrepancies.map((d: any) => ({
          run_id:             run.id,
          severity:           d.severity            ?? null,
          category:           d.category            ?? null,
          member_mark:        d.member_mark          ?? null,
          input1_value:       d.input1_says          ?? null,
          input2_value:       d.input2_says          ?? null,
          input3_value:       d.input3_says          ?? null,
          recommended_action: d.recommended_action   ?? null,
        }))

        const { error: discError } = await supabase
          .from('discrepancies')
          .insert(rows)

        if (discError) throw discError
      }

    } catch (err) {
      console.error('Supabase save error:', err)
    }

    return NextResponse.json(result)

  } catch (err) {
    console.error('QAi analysis error:', err)
    return NextResponse.json(
      { error: 'Analysis failed', detail: String(err) },
      { status: 500 }
    )
  }
}
