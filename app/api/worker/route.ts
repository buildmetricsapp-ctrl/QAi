import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import JSZip from 'jszip'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_PDF_PAGES = 5
const BATCH_SIZE    = 5
const TEXT_LIMIT    = 2000

// ─── PDF Text Extraction ──────────────────────────────────────────────────────
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
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
type ZipEntry = { name: string; getData: () => Promise<ArrayBuffer> }

const ALLOWED_EXTS = ['.pdf', '.nc', '.dstv', '.csv', '.txt']

async function getZipEntries(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const zip = await JSZip.loadAsync(buffer)
  const entries: ZipEntry[] = []
  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const lower = filename.toLowerCase()
    if (!ALLOWED_EXTS.some(ext => lower.endsWith(ext))) continue
    const shortName = filename.split('/').pop() || filename
    entries.push({ name: shortName, getData: () => entry.async('arraybuffer') })
  }
  return entries
}

// ─── Download from Supabase Storage ──────────────────────────────────────────
async function downloadFile(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from('qai-uploads').download(path)
  if (error) throw error
  return data.arrayBuffer()
}

// ─── Get entries from storage paths ──────────────────────────────────────────
async function getEntriesFromPaths(paths: string[]): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  for (const path of paths) {
    const name = path.split('/').pop() || path
    if (name.toLowerCase().endsWith('.zip')) {
      const buf = await downloadFile(path)
      entries.push(...await getZipEntries(buf))
    } else {
      entries.push({ name, getData: () => downloadFile(path) })
    }
  }
  return entries
}

// ─── Read entries to text ─────────────────────────────────────────────────────
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

// ─── Prompt Builder ───────────────────────────────────────────────────────────
function buildPrompt(text1: string, text2: string, text3: string, batchInfo: string, providedInputs: string[], missingInputs: string[]): string {
  return `You are QAi — an expert steel detailing quality assurance system.

INPUT 1 — PROJECT DOCUMENTS:
${text1 || '[NOT PROVIDED]'}

INPUT 2 — TEKLA MODEL REPORT:
${text2 || '[NOT PROVIDED]'}

INPUT 3 — FABRICATION OUTPUTS:
${text3 || '[NOT PROVIDED]'}

${batchInfo}

${missingInputs.length > 0 ? `IMPORTANT: Only ${providedInputs.join(' and ')} were provided. ${missingInputs.join(', ')} was NOT provided.` : ''}

Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON:
{
  "project_summary": {
    "project_name": "string",
    "revision": "string",
    "status": "PASS | REVIEW REQUIRED | FAIL",
    "total_members": 0,
    "total_weight": "string",
    "critical_count": 0,
    "major_count": 0,
    "minor_count": 0,
    "input1_files": [],
    "input2_files": [],
    "input3_files": [],
    "summary_notes": "string"
  },
  "discrepancies": [
    {
      "id": "D001",
      "severity": "CRITICAL | MAJOR | MINOR",
      "category": "Section size | Steel grade | Dimension | Bolt spec | Weld detail | Surface treatment | Missing member | Position | Other",
      "member_mark": "string",
      "description": "string",
      "input1_says": "string",
      "input2_says": "string",
      "input3_says": "string",
      "recommended_action": "string"
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

// ─── Merge Results ────────────────────────────────────────────────────────────
function mergeResults(results: any[]): any {
  if (results.length === 1) return results[0]
  const base = results[0]
  const allDiscrepancies: any[] = []
  let idCounter = 1
  for (const result of results) {
    for (const d of (result.discrepancies ?? [])) {
      allDiscrepancies.push({ ...d, id: `D${String(idCounter++).padStart(3, '0')}` })
    }
  }
  const critical = allDiscrepancies.filter(d => d.severity === 'CRITICAL').length
  const major    = allDiscrepancies.filter(d => d.severity === 'MAJOR').length
  const minor    = allDiscrepancies.filter(d => d.severity === 'MINOR').length
  const total    = allDiscrepancies.length
  let status = 'PASS'
  if (critical > 0) status = 'FAIL'
  else if (major > 0 || minor > 0) status = 'REVIEW REQUIRED'
  const allNotes = results.map(r => r.project_summary?.summary_notes).filter(Boolean).join(' | ')
  return {
    project_summary: {
      ...base.project_summary,
      status,
      critical_count: critical,
      major_count:    major,
      minor_count:    minor,
      summary_notes:  `${total} discrepancies found across ${results.length} batch(es): ${critical} CRITICAL, ${major} MAJOR, ${minor} MINOR. ${allNotes}`,
    },
    discrepancies: allDiscrepancies,
  }
}

// ─── Main Worker ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { jobId } = await req.json()
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  try {
    // Fetch job
    const { data: job, error: jobError } = await supabase
      .from('jobs').select('*').eq('id', jobId).single()
    if (jobError) throw jobError

    // Mark as processing
    await supabase.from('jobs').update({ status: 'processing' }).eq('id', jobId)

    // Get entries from storage
    const [entries1, entries2, entries3] = await Promise.all([
      getEntriesFromPaths(job.input1_paths ?? []),
      getEntriesFromPaths(job.input2_paths ?? []),
      getEntriesFromPaths(job.input3_paths ?? []),
    ])

    console.log(`[QAi Worker] Job ${jobId} — Input1: ${entries1.length}, Input2: ${entries2.length}, Input3: ${entries3.length}`)

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

    const text2 = await readEntriesToText(entries2, 'INPUT-2 (Tekla Model Report)')

    // Chunk inputs
    const chunk1s: ZipEntry[][] = []
    for (let i = 0; i < Math.max(entries1.length, 1); i += BATCH_SIZE) chunk1s.push(entries1.slice(i, i + BATCH_SIZE))

    const chunk3s: ZipEntry[][] = []
    for (let i = 0; i < Math.max(entries3.length, 1); i += BATCH_SIZE) chunk3s.push(entries3.slice(i, i + BATCH_SIZE))

    const totalBatches = Math.max(chunk1s.length, chunk3s.length)

    // Update total batches
    await supabase.from('jobs').update({ total_batches: totalBatches }).eq('id', jobId)

    const batchResults: any[] = []

    for (let i = 0; i < totalBatches; i++) {
      const c1 = chunk1s[i] ?? []
      const c3 = chunk3s[i] ?? []

      console.log(`[QAi Worker] Batch ${i + 1}/${totalBatches}`)

      const [text1, text3] = await Promise.all([
        readEntriesToText(c1, 'INPUT-1 (Project Documents)'),
        readEntriesToText(c3, 'INPUT-3 (Fabrication Outputs)'),
      ])

      const batchInfo = totalBatches > 1
        ? `NOTE: Batch ${i + 1} of ${totalBatches}. Comparing Input 1 files [${c1.map(e => e.name).join(', ') || 'none'}] against Input 3 files [${c3.map(e => e.name).join(', ') || 'none'}].`
        : ''

      const prompt = buildPrompt(text1, text2, text3, batchInfo, providedInputs, missingInputs)
      const result = await callClaude(prompt)
      batchResults.push(result)

      // Update progress
      await supabase.from('jobs').update({ completed_batches: i + 1 }).eq('id', jobId)
      await new Promise(r => setTimeout(r, 300))
    }

    const finalResult = mergeResults(batchResults)

    // Save to projects/runs/discrepancies
    const projectName = finalResult.project_summary?.project_name ?? 'Unnamed Project'
    const { data: project } = await supabase
      .from('projects').upsert({ name: projectName }, { onConflict: 'name' }).select().single()

    if (project) {
      const { data: run } = await supabase.from('runs').insert({
        project_id:    project.id,
        revision:      finalResult.project_summary?.revision      ?? null,
        status:        finalResult.project_summary?.status        ?? null,
        member_count:  finalResult.project_summary?.total_members ?? null,
        total_weight:  parseFloat(finalResult.project_summary?.total_weight ?? '') || null,
        issue_count:   finalResult.discrepancies?.length          ?? 0,
        summary_notes: finalResult.project_summary?.summary_notes ?? null,
      }).select().single()

      if (run && finalResult.discrepancies?.length > 0) {
        await supabase.from('discrepancies').insert(
          finalResult.discrepancies.map((d: any) => ({
            run_id:             run.id,
            severity:           d.severity            ?? null,
            category:           d.category            ?? null,
            member_mark:        d.member_mark          ?? null,
            input1_value:       d.input1_says          ?? null,
            input2_value:       d.input2_says          ?? null,
            input3_value:       d.input3_says          ?? null,
            recommended_action: d.recommended_action   ?? null,
          }))
        )
      }
    }

    // Mark job complete with result
    await supabase.from('jobs').update({
      status: 'complete',
      result: finalResult,
      project_name: projectName,
    }).eq('id', jobId)

    // Clean up storage
    const allPaths = [...(job.input1_paths ?? []), ...(job.input2_paths ?? []), ...(job.input3_paths ?? [])]
    if (allPaths.length > 0) {
      await supabase.storage.from('qai-uploads').remove(allPaths)
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('[QAi Worker] Error:', err)
    await supabase.from('jobs').update({
      status: 'error',
      error: String(err),
    }).eq('id', jobId)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
