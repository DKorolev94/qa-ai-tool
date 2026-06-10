import { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import type { RunRequest, StepRecord } from './types.js'

export interface RunResult {
  status: 'passed' | 'failed' | 'blocked'
  summary: string
  steps: StepRecord[]
  errors: string[]
  duration_sec: number
}

export type OnStep = (step: StepRecord, url: string, title: string) => void

const VerdictSchema = z.object({
  status: z.enum(['passed', 'failed', 'blocked']),
  summary: z.string(),
})

export async function runTask(req: RunRequest, onStep: OnStep): Promise<RunResult> {
  const startedAt = Date.now()
  const maxSteps = req.max_steps ?? Number(process.env.MAX_STEPS ?? 20)
  const headless = req.headless ?? (process.env.HEADLESS !== 'false')
  // modelName is typed as AvailableModel enum; cast to allow custom model strings (e.g. ollama) via env
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (req.llm_model ?? process.env.LLM_MODEL ?? 'gpt-4o') as any
  const baseURL = req.llm_base_url ?? process.env.LLM_BASE_URL
  const apiKey = req.llm_api_key ?? process.env.LLM_API_KEY ?? 'ollama'

  const clientOptions: Record<string, string> = { apiKey }
  if (baseURL) clientOptions.baseURL = baseURL

  const stagehand = new Stagehand({
    env: 'LOCAL',
    headless,
    modelName: model,
    modelClientOptions: clientOptions,
    logger: () => {},
  })

  const steps: StepRecord[] = []
  const errors: string[] = []

  try {
    await stagehand.init()
    const page = stagehand.page

    if (req.start_url) {
      await page.goto(req.start_url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    }

    for (let i = 0; i < maxSteps; i++) {
      const stepStart = Date.now()
      const stepNum = i + 1
      const url = page.url()
      const title = await page.title().catch(() => '')

      // Observe what actions are possible given the task
      const observations = await page.observe({
        instruction: `Continue executing this test case step by step. Stop when it is complete or cannot proceed.\n\n${req.task}`,
      })

      if (!observations.length) break

      const nextAction = observations[0]
      const actionDesc: string = nextAction.description ?? String(nextAction)

      let actError = false
      try {
        await page.act({ action: actionDesc })
      } catch (err) {
        const msg = `Step ${stepNum}: ${String(err)}`
        errors.push(msg)
        actError = true
      }

      const screenshotBuf = await page.screenshot({ type: 'png' }).catch(() => Buffer.alloc(0))
      const screenshot_b64 = screenshotBuf.length ? screenshotBuf.toString('base64') : undefined
      const duration_sec = (Date.now() - stepStart) / 1000

      const step: StepRecord = {
        step: stepNum,
        status: actError ? 'error' : 'ok',
        summary: actionDesc,
        url,
        duration_sec,
        screenshot_b64,
      }
      steps.push(step)
      onStep(step, url, title)

      // After each action check if the task is complete
      const check = await page.extract({
        instruction: 'Is the test case execution complete? Answer with complete=true only when all steps are done or the test cannot proceed.',
        schema: z.object({ complete: z.boolean() }),
      }).catch(() => ({ complete: false }))

      if (check.complete) break
    }

    // Final verdict
    const verdict = await page.extract({
      instruction: `Based on everything that happened, what is the final verdict for this test case?\n\n${req.task}`,
      schema: VerdictSchema,
    }).catch(() => ({ status: 'blocked' as const, summary: 'Could not determine verdict' }))

    await stagehand.close()
    const duration_sec = (Date.now() - startedAt) / 1000

    return {
      status: verdict.status,
      summary: verdict.summary,
      steps,
      errors,
      duration_sec,
    }
  } catch (err) {
    await stagehand.close().catch(() => {})
    const duration_sec = (Date.now() - startedAt) / 1000
    const msg = `Runner error: ${String(err)}`
    return {
      status: 'blocked',
      summary: msg,
      steps,
      errors: [...errors, msg],
      duration_sec,
    }
  }
}
