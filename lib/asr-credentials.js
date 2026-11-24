import { validateHeaderValue } from 'node:http'
import { volcSettings } from './asr.js'

const RECORD = 'duanju-slice/volc-asr'

// Host-only: read on demand so the next ASR operation sees a rotated key.
export async function resolveAsrApiKey(credentials, config) {
  try {
    const record = await credentials?.readRecord(RECORD)
    const saved = record?.kind === 'api-key' && typeof record.key === 'string' ? record.key.trim() : ''
    return saved || volcSettings(config).apiKey
  } catch {
    throw new Error('无法读取火山语音识别 API Key。')
  }
}

export async function asrApiKeyStatus(credentials, config) {
  return Boolean(await resolveAsrApiKey(credentials, config))
}

export async function saveAsrApiKey(credentials, input) {
  const key = typeof input === 'string' ? input.trim() : ''
  if (!key) throw new Error('请输入火山语音识别 API Key。')
  try {
    validateHeaderValue('X-Api-Key', key)
  } catch {
    throw new Error('火山语音识别 API Key 格式无效。')
  }
  if (!credentials) throw new Error('安全凭据存储不可用，无法保存火山语音识别 API Key。')
  try {
    await credentials.modifyRecord(RECORD, async () => ({ kind: 'api-key', key }))
  } catch {
    throw new Error('无法保存火山语音识别 API Key。')
  }
}
