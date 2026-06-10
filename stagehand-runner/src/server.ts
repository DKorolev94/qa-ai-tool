import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { v4 as uuidv4 } from 'uuid'
import { runTask } from './runner.js'
import * as store from './store.js'
import type { RunRequest, RunResponse, UiStep, WsEvent } from './types.js'

export function buildServer() {
  const app = Fastify({ logger: false })
  app.register(fastifyWebsocket)

  // POST /run — sync execution (blocks until done)
  app.post<{ Body: RunRequest }>('/run', async (req, reply) => {
    const body = req.body
    const run_id = uuidv4()
    const record = store.createRun(run_id, body.test_case_id)

    const result = await runTask(body, (step) => {
      store.pushStep(run_id, step)
    })

    store.finishRun(run_id, result)

    const screenshotPaths = record.steps
      .map(s => s.screenshot_path)
      .filter((p): p is string => typeof p === 'string')

    const response: RunResponse = {
      run_id,
      status: result.status,
      summary: result.summary,
      steps_count: result.steps.length,
      errors: result.errors,
      duration_sec: result.duration_sec,
      artifacts: { screenshot_paths: screenshotPaths },
    }
    return response
  })

  // POST /start — async execution, returns run_id immediately
  app.post<{ Body: RunRequest }>('/start', async (req, reply) => {
    const body = req.body
    const run_id = uuidv4()
    store.createRun(run_id, body.test_case_id)

    // Start in background
    setImmediate(async () => {
      const q = store.getQueue(run_id)
      const emit = (event: WsEvent) => q?.push(JSON.stringify(event))
      const startedAt = Date.now()

      try {
        const result = await runTask(body, (step, url, title) => {
          store.pushStep(run_id, step)
          emit({
            type: 'step',
            step: step.step,
            url,
            title,
            next_goal: step.summary,
            screenshot_b64: step.screenshot_b64,
            elapsed_sec: (Date.now() - startedAt) / 1000,
          })
        })

        store.finishRun(run_id, result)
        emit({
          type: 'done',
          status: result.status,
          summary: result.summary,
          duration_sec: result.duration_sec,
          steps_count: result.steps.length,
          errors: result.errors,
          run_id,
        })
      } catch (err) {
        const msg = String(err)
        store.finishRun(run_id, {
          status: 'error',
          summary: msg,
          errors: [msg],
          duration_sec: (Date.now() - startedAt) / 1000,
        })
        emit({ type: 'error', message: msg })
      }
    })

    return { run_id }
  })

  // WS /ws/:run_id — stream events
  app.get('/ws/:run_id', { websocket: true }, (socket, req) => {
    const { run_id } = req.params as { run_id: string }
    const queue = store.getQueue(run_id)

    if (!queue) {
      socket.send(JSON.stringify({ type: 'error', message: `Run ${run_id} not found` }))
      socket.close()
      return
    }

    // Send buffered events (client reconnected or joined late)
    for (const msg of queue.drain()) {
      socket.send(msg)
    }

    // If already done, nothing more to send
    if (queue.closed) {
      socket.close()
      return
    }

    // Subscribe to live events
    const unsub = queue.subscribe(msg => {
      try { socket.send(msg) } catch {}
    })

    socket.on('close', unsub)
    socket.on('error', unsub)
  })

  // GET /runs — list completed runs
  app.get<{ Querystring: { limit?: string } }>('/runs', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100)
    return { runs: store.listRuns(limit) }
  })

  // GET /runs/:run_id — get full record
  app.get<{ Params: { run_id: string } }>('/runs/:run_id', async (req, reply) => {
    const record = store.getRecord(req.params.run_id)
    if (!record) return reply.code(404).send({ error: 'Not found' })
    return record
  })

  // GET /runs/:run_id/steps — steps in browser-use-runner format
  app.get<{ Params: { run_id: string } }>('/runs/:run_id/steps', async (req, reply) => {
    const record = store.getRecord(req.params.run_id)
    if (!record) return reply.code(404).send({ error: 'Not found' })

    const steps: UiStep[] = record.steps.map(s => ({
      step: s.step,
      status: s.status,
      summary: s.summary,
      url: s.url,
      duration_sec: s.duration_sec,
      screenshot: s.screenshot_path
        ? { path: s.screenshot_path, size_bytes: 0 }
        : null,
    }))
    return { steps }
  })

  return app
}
