import 'dotenv/config'
import { buildServer } from './server.js'

const PORT = Number(process.env.PORT ?? 8009)

const app = buildServer()

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`stagehand-runner listening on http://0.0.0.0:${PORT}`)
} catch (err) {
  console.error(err)
  process.exit(1)
}
