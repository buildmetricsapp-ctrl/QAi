import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const input1Files = form.getAll('input1') as File[]
    const input2Files = form.getAll('input2') as File[]
    const input3Files = form.getAll('input3') as File[]

    // Read all files as text
    const readFile = async (f: File): Promise<string> => {
      const buf = await f.arrayBuffer()
      try {
        return new TextDecoder('utf-8').decode(buf)
      } catch {
        return `[Binary file: ${f.name} — ${f.size} bytes]`
      }
    }

    const read = async (files: File[], label: string) => {
      const results = await Promise.all(
        files.map(async f => {
          const content = await readFile(f)
          return `--- ${label} FILE: ${f.name} ---\n${content.slice(0, 8000)}`
        })
      )
      return results.join('\n\n')
    }

    const [text1, text2, text3] = await Promise.all([
      read(input1Files, 'INPUT-1 (Project Documents)'),
      read(input2Files, 'INPUT-2 (Tekla Model Report)'),
      read(input3Files, 'INPUT-3 (Fabrication Outputs)'),
    ])

    const prompt = `You are QAi — an expert steel detailing quality assurance system.

You have been given three inputs from a steel construction project:

INPUT 1 — PROJECT DOCUMENTS (scope sheet, specs, RFIs, codes, emails, MOM):
${text1}

INPUT 2 — TEKLA MODEL REPORT (member data extracted from the 3D model):
${text2}

INPUT 3 — FABRICATION OUTPUTS (shop drawings, erection drawings, NC/DSTV files):
${text3}

Your job is to:
1. Compare Input 1 (design intent) vs Input 2 (what was modelled) vs Input 3 (what was fabricated)
2. List every discrepancy you find — mismatched sections, wrong grades, incorrect dimensions, bolt/weld differences, missing members, surface treatment conflicts, and any other deviations
3. Classify each discrepancy by severity: CRITICAL (stops fabrication or is unsafe), MAJOR (significant rework needed), MINOR (note for record)
4. Produce a grand project summary

Respond ONLY with a valid JSON object in exactly this structure — no markdown, no explanation outside the JSON:
{
  "project_summary": {
    "total_discrepancies": 0,
    "critical": 0,
    "major": 0,
    "minor": 0,
    "input1_files": [],
    "input2_files": [],
    "input3_files": [],
    "overall_status": "PASS | REVIEW REQUIRED | FAIL",
    "summary_note": "One paragraph plain-English summary of the overall QA result"
  },
  "discrepancies": [
    {
      "id": "D001",
      "severity": "CRITICAL | MAJOR | MINOR",
      "category": "Section size | Steel grade | Dimension | Bolt spec | Weld detail | Surface treatment | Missing member | Position | Other",
      "member_mark": "e.g. B1, C3, A1/1",
      "description": "Plain English description of the discrepancy",
      "input1_says": "What the project documents specify",
      "input2_says": "What the Tekla model shows",
      "input3_says": "What the fabrication output shows",
      "recommended_action": "What needs to be corrected and by whom"
    }
  ]
}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = raw.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)

    return NextResponse.json(result)
  } catch (err) {
    console.error('QAi analysis error:', err)
    return NextResponse.json(
      { error: 'Analysis failed', detail: String(err) },
      { status: 500 }
    )
  }
}
