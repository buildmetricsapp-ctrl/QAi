import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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
      const name = f.name.toLowerCase()
      if (name.endsWith('.pdf')) {
        return `[PDF file: ${f.name} — ${f.size} bytes — content not extractable as text, use filename and size as reference]`
      }
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
      input1Files.length > 0 ? read(input1Files, 'INPUT-1 (Project Documents)') : '',
      input2Files.length > 0 ? read(input2Files, 'INPUT-2 (Tekla Model Report)') : '',
      input3Files.length > 0 ? read(input3Files, 'INPUT-3 (Fabrication Outputs)') : '',
    ])

    const providedInputs = [
      input1Files.length > 0 ? 'Input 1 (Project Documents)' : null,
      input2Files.length > 0 ? 'Input 2 (Tekla Model Report)' : null,
      input3Files.length > 0 ? 'Input 3 (Fabrication Outputs)' : null,
    ].filter(Boolean)

    const missingInputs = [
      input1Files.length === 0 ? 'Input 1 (Project Documents)' : null,
      input2Files.length === 0 ? 'Input 2 (Tekla Model Report)' : null,
      input3Files.length === 0 ? 'Input 3 (Fabrication Outputs)' : null,
    ].filter(Boolean)

    const prompt = `You are QAi — an expert steel detailing quality assurance system.

You have been given inputs from a steel construction project:

INPUT 1 — PROJECT DOCUMENTS (scope sheet, specs, RFIs, codes, emails, MOM):
${text1 || '[NOT PROVIDED]'}

INPUT 2 — TEKLA MODEL REPORT (member data extracted from the 3D model):
${text2 || '[NOT PROVIDED]'}

INPUT 3 — FABRICATION OUTPUTS (shop drawings, erection drawings, NC/DSTV files):
${text3 || '[NOT PROVIDED]'}

Your job is to:
1. Compare the provided inputs against each other
2. List every discrepancy you find — mismatched sections, wrong grades, incorrect dimensions, bolt/weld differences, missing members, surface treatment conflicts, and any other deviations
3. Classify each discrepancy by severity: CRITICAL (stops fabrication or is unsafe), MAJOR (significant rework needed), MINOR (note for record)
4. Produce a grand project summary

${missingInputs.length > 0 ? `IMPORTANT: Only ${providedInputs.join(' and ')} were provided. ${missingInputs.join(', ')} was NOT provided. Base your analysis only on the available inputs and clearly state which inputs were compared in your summary_notes.` : ''}

Respond ONLY with a valid JSON object in exactly this structure — no markdown, no explanation outside the JSON:
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

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = raw.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)

    // Save to Supabase
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
          project_id: project.id,
          revision: result.project_summary?.revision ?? null,
          status: result.project_summary?.status ?? null,
          member_count: result.project_summary?.total_members ?? null,
          total_weight: result.project_summary?.total_weight ?? null,
          issue_count: result.discrepancies?.length ?? 0,
          summary_notes: result.project_summary?.summary_notes ?? null,
        })
        .select()
        .single()

      if (runError) throw runError

      if (result.discrepancies?.length > 0) {
        const rows = result.discrepancies.map((d: any) => ({
          run_id: run.id,
          severity: d.severity ?? null,
          category: d.category ?? null,
          member_mark: d.member_mark ?? null,
          input1_value: d.input1_says ?? null,
          input2_value: d.input2_says ?? null,
          input3_value: d.input3_says ?? null,
          recommended_action: d.recommended_action ?? null,
        }))

        const { error: discError } = await supabase
          .from('discrepancies')
          .insert(rows)

        if (discError) throw discError
      }

    } catch (err) {
      console.error('Supabase save error:', err)
    }

    // Return AFTER Supabase save
    return NextResponse.json(result)

  } catch (err) {
    console.error('QAi analysis error:', err)
    return NextResponse.json(
      { error: 'Analysis failed', detail: String(err) },
      { status: 500 }
    )
  }
}