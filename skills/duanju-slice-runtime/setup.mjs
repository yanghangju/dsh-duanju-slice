import { runRuntimeRequest } from '../../lib/promo/runtime-request.js'
import { configureRuntime } from '../../lib/promo/runtime-setup.js'

const id = process.argv[2]
const cancel = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => cancel.abort(new Error('环境配置已取消')))
}
try {
  const result = await runRuntimeRequest(id, configureRuntime, cancel.signal)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
