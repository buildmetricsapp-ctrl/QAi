import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const input1Files = form.getAll('input1') as File[]
    const input2Files = form.getAll('input2') as File[]
    const input3Files = form.getAll('input3') as File[]

    // Create job record first
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({ status: 'uploading' })
      .select()
      .single()

    if (jobError) throw jobError

    const jobId = job.id

    // Upload files to Supabase Storage
    const uploadFiles = async (files: File[], slot: string) => {
      const paths: string[] = []
      for (const f of files) {
        const path = `${jobId}/${slot}/${f.name}`
        const buf = await f.arrayBuffer()
        const { error } = await supabase.storage
          .from('qai-uploads')
          .upload(path, buf, { contentType: f.type || 'application/octet-stream' })
        if (error) throw error
        paths.push(path)
      }
      return paths
    }

    const [paths1, paths2, paths3] = await Promise.all([
      uploadFiles(input1Files, 'input1'),
      uploadFiles(input2Files, 'input2'),
      uploadFiles(input3Files, 'input3'),
    ])

    // Update job to queued with file paths
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'queued',
        input1_paths: paths1,
        input2_paths: paths2,
        input3_paths: paths3,
      })
      .eq('id', jobId)

    if (updateError) throw updateError

    return NextResponse.json({ jobId })

  } catch (err) {
    console.error('[QAi] Job creation error:', err)
    return NextResponse.json(
      { error: 'Failed to create job', detail: String(err) },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('id')
  if (!jobId) return NextResponse.json({ error: 'Missing job ID' }, { status: 400 })

  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}