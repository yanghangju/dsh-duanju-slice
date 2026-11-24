import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asrApiKeyStatus, resolveAsrApiKey, saveAsrApiKey } from '../lib/asr-credentials.js'

const RECORD = 'duanju-slice/volc-asr'
const CONFIG = { volcApiKey: '  fake-config-key  ' }

function memoryCredentials(record) {
  return {
    async readRecord(id) {
      assert.equal(id, RECORD)
      return record
    },
    async modifyRecord(id, mutate) {
      assert.equal(id, RECORD)
      record = await mutate(record)
      return record
    },
  }
}

test('saved ASR key overrides the legacy key and is read again after rotation', async () => {
  const credentials = memoryCredentials({ kind: 'api-key', key: '  fake-stored-key  ' })
  assert.equal(await resolveAsrApiKey(credentials, CONFIG), 'fake-stored-key')
  assert.equal(await asrApiKeyStatus(credentials, CONFIG), true)
  assert.equal(await saveAsrApiKey(credentials, '  fake-rotated-key  '), undefined)
  assert.deepEqual(await credentials.readRecord(RECORD), { kind: 'api-key', key: 'fake-rotated-key' })
  assert.equal(await resolveAsrApiKey(credentials, CONFIG), 'fake-rotated-key')
})

test('unset or empty records leave legacy config and both environment variable names usable', async (t) => {
  const originalEnv = process.env
  const env = { VOLCENGINE_API_KEY: '  fake-primary-key  ', VOLC_API_KEY: '  fake-alias-key  ' }
  process.env = env
  t.after(() => { process.env = originalEnv })

  const empty = memoryCredentials({ kind: 'api-key', key: '  ' })
  assert.equal(await resolveAsrApiKey(empty, CONFIG), 'fake-config-key')
  assert.equal(await resolveAsrApiKey(undefined, CONFIG), 'fake-config-key')
  assert.equal(await resolveAsrApiKey(memoryCredentials(), { volcApiKey: '  ' }), 'fake-primary-key')
  assert.equal(await asrApiKeyStatus(empty), true)
  delete env.VOLCENGINE_API_KEY
  assert.equal(await resolveAsrApiKey(empty), 'fake-alias-key')
  delete env.VOLC_API_KEY
  assert.equal(await resolveAsrApiKey(empty), '')
  assert.equal(await asrApiKeyStatus(empty), false)
})

test('blank or invalid submitted keys do not overwrite a stored key', async () => {
  const credentials = memoryCredentials({ kind: 'api-key', key: 'fake-stored-key' })
  await assert.rejects(saveAsrApiKey(credentials, ' \t '), { message: '请输入火山语音识别 API Key。' })
  await assert.rejects(saveAsrApiKey(credentials, 'fake-input\nwith-break'), { message: '火山语音识别 API Key 格式无效。' })
  assert.equal(await resolveAsrApiKey(credentials), 'fake-stored-key')
})

test('credential storage errors never expose input or backend diagnostics', async () => {
  const credentials = {
    async readRecord() { throw new Error('fake-stored-secret') },
    async modifyRecord(_id, mutate) { throw new Error((await mutate()).key) },
  }
  await assert.rejects(asrApiKeyStatus(credentials), { message: '无法读取火山语音识别 API Key。' })
  await assert.rejects(saveAsrApiKey(credentials, 'fake-input'), { message: '无法保存火山语音识别 API Key。' })
  await assert.rejects(saveAsrApiKey(undefined, 'fake-input'), { message: '安全凭据存储不可用，无法保存火山语音识别 API Key。' })
})
