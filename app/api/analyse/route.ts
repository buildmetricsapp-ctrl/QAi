import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import JSZip from 'jszip'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_PDF_PAGES  = 10  // pages to extract per PDF
const BATCH_SIZE     = 10  // fabrication PDFs per Claude call
const TEXT_LIMIT     = 3000 // chars per file sent to Claude

// ─── PDF Text Extraction ──────────────────────────────────────────────────────
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PDFParser = require('pdf2json')
      const parser = new PDFParser()

      parser.on('pdfParser_dataReady', (data: any) => {
        try {
          const pages = data.Pages?.slice(0, MAX_PDF_PAGES) ?? []
          const text = pages.map((page: any, i: number) => {
            const pageText = (page.Texts ?? [])
              .map((t: any) =>
                (t.R ?? [])
                  .map((r: any) => decodeURIComponent(r.T ?? ''))
                  .join('')
              )
              .filter(Boolean)
              .join(' ')
            return `[Page ${i + 1}]\n${pageText}`
          }).join('\n\n')
          resolve(text || '[PDF parsed but no text found]')
        } catch {
          resolve('[PDF parse error during text extraction]')
        }
      })

      parser.on('pdfParser_dataError', (err: any) => {
        console.error('[QAi] pdf2json error:', err)
        resolve('[PDF could not be parsed]')
      })

      parser.parseBuffer(Buffer.from(buffer))
    } catch (err) {
      console.error('[QAi] pdf2json load error:', err)
      resolve('[PDF extraction unavailable]')
    }
  })
}

// ─── ZIP Extraction ───────────────────────────────────────────────────────────
async function extractPdfsFromZip(zipFile: File): Promise<File[]> {
  const buf = await zipFile.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const files: File[] = []

  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const lower = filename.toLowerCase()
    if (!lower.endsWith('.pdf') && !lower.endsWith('.nc') &&
        !lower.endsWith('.dstv') && !lower.endsWith('.csv') &&
        !lower.endsWith('.txt')) continue
    const data = await entry.async('arraybuffer')
    const shortName = filename.split('/').pop() || filename
    files.push(new File([data], shortName))
  }

  return files
}

async function expandZips(files: File[]): Promise<File[]> {
  const result: File[] = []
  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      result.push(...await extractPdfsFromZip(f))
    } else {
      result.push(f)
    }
  }
  return result
}

// ─── File Reading ─────────────────────────────────────────────────────────────
async function readFile(f: File): Promise<string> {
  const buf  = await f.arrayBuffer()
  const name = f.name.toLowerCase()

  if (name.endsWith('.pdf')) {
    const text = await extractPdfText(buf)
    return `[PDF: ${f.name}]\n${text}`
  }

  try {
    return new TextDecoder('utf-8').decode(buf)
  } catch {
    return `[Binary file: ${f.name} — ${f.size} bytes]`
  }
}

async function readFilesToText(files: File[], label: string): Promise<string> {
  if (files.length === 0) return ''
  const results = await Promise.all(files.map(readFile))
  return results
    .map((content, i) => `--- ${label} FILE: ${files[i].name} ---\n${content.slice(0, TEXT_LIMIT)}`)
    .join('\n\n')
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
      "input1_says": "What the project documents specify or N/A if not provided",
      "input2_says": "What the Tekla model shows or N/A if not provided",
      "input3_says": "What the fabrication output shows or N/A if not provided",
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

    const input1Files = await expandZips(form.getAll('input1') as File[])
    const input2Files = await expandZips(form.getAll('input2') as File[])
    const input3Files = await expandZips(form.getAll('input3') as File[])

    console.log(`[QAi] Files — Input1: ${input1Files.length}, Input2: ${input2Files.length}, Input3: ${input3Files.length}`)

    const providedInputs = [
      input1Files.length > 0 ? 'Input 1 (Project Documents)' : null,
      input2Files.length > 0 ? 'Input 2 (Tekla Model Report)' : null,
      input3Files.length > 0 ? 'Input 3 (Fabrication Outputs)' : null,
    ].filter(Boolean) as string[]

    const missingInputs = [
      input1Files.length === 0 ? 'Input 1 (Project Documents)' : null,
      input2Files.length === 0 ? 'Input 2 (Tekla Model Report)' : null,
      input3Files.length === 0 ? 'Input 3 (Fabrication Outputs)' : null,
    ].filter(Boolean) as string[]

    // Input 1 and 2 are always sent in full as context to every batch
    const [text1, text2] = await Promise.all([
      readFilesToText(input1Files, 'INPUT-1 (Project Documents)'),
      readFilesToText(input2Files, 'INPUT-2 (Tekla Model Report)'),
    ])

    const batchResults: any[] = []

    if (input3Files.length === 0) {
      // No Input 3 — single call
      const prompt = buildPrompt(text1, text2, '', '', providedInputs, missingInputs)
      batchResults.push(await callClaude(prompt))
    } else {
      // Chunk Input 3 into batches
      const chunks: File[][] = []
      for (let i = 0; i < input3Files.length; i += BATCH_SIZE) {
        chunks.push(input3Files.slice(i, i + BATCH_SIZE))
      }

      console.log(`[QAi] ${input3Files.length} Input-3 files → ${chunks.length} batch(es)`)

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        console.log(`[QAi] Batch ${i + 1}/${chunks.length}: ${chunk.map(f => f.name).join(', ')}`)

        const text3    = await readFilesToText(chunk, 'INPUT-3 (Fabrication Outputs)')
        const batchInfo = chunks.length > 1
          ? `NOTE: Batch ${i + 1} of ${chunks.length}. Analysing ${chunk.length} file(s): ${chunk.map(f => f.name).join(', ')}. Cross-reference against all of Input 1 and Input 2.`
          : ''

        const prompt = buildPrompt(text1, text2, text3, batchInfo, providedInputs, missingInputs)
        batchResults.push(await callClaude(prompt))
      }
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
          total_weight:  result.project_summary?.total_weight  ?? null,
          issue_count:   result.discrepancies?.length          ?? 0,
          summary_notes: result.project_summary?.summary_notes ?? null,
        })
        .select()
        .single()

      if (runError) throw runError

      if (result.discrepancies?.length > 0) {
        const rows = result.discrepancies.map((d: any) => ({
          run_id:             run.id,
          severity:           d.severity           ?? null,
          category:           d.category           ?? null,
          member_mark:        d.member_mark         ?? null,
          input1_value:       d.input1_says         ?? null,
          input2_value:       d.input2_says         ?? null,
          input3_value:       d.input3_says         ?? null,
          recommended_action: d.recommended_action  ?? null,
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
