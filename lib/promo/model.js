// Shared Host model calls for script planning and visual video alignment.
export async function selectModel(ctx, { provider, model, signal, images = false } = {}) {
  const llm = ctx.get('llm')
  if (!llm) throw new Error('当前运行环境没有可用的 llm 服务')
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  provider ??= selection?.provider
  model ??= selection?.model
  if (!provider || !model) throw new Error('无法确定使用哪个模型，请显式传入 provider 与 model')
  if (images) {
    const info = await llm.resolveModelInfo(provider, model, signal)
    if (!info?.inputModalities?.includes('image')) {
      throw new Error(`模型 ${provider}/${model} 不支持图像输入，无法理解视频；请为 duanju_slice_advanced 的 locate 或 locate_montage 指定支持图片的 data.provider / data.model`)
    }
  }
  return { provider, model }
}

export async function generateText(ctx, { provider, model, system, user, content, signal, maxTokens = 12_000, onText }) {
  const selected = await selectModel(ctx, { provider, model, signal })
  let response = ''
  for await (const chunk of ctx.get('llm').stream({
    ...selected,
    system,
    messages: [{ role: 'user', content: content ?? [{ type: 'text', text: user }] }],
    maxTokens,
    signal,
  })) {
    if (chunk.type === 'text-delta') {
      response += chunk.text
      onText?.(chunk.text)
    } else if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'error') throw new Error(`模型调用失败：${chunk.reason.failure?.message ?? '未知错误'}`)
      if (chunk.reason.kind === 'max-tokens') throw new Error('模型输出被 maxTokens 截断，请缩短请求或换用输出更长的模型')
      if (chunk.reason.kind === 'aborted') throw new Error('模型调用已取消（aborted）')
    }
  }
  signal?.throwIfAborted()
  if (!response.trim()) throw new Error('模型没有返回任何内容')
  return { response, ...selected }
}

export function parseModelJson(text) {
  const cleaned = String(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`模型没有返回 JSON：${cleaned.slice(0, 200)}`)
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (error) {
    throw new Error(`模型返回的 JSON 无法解析：${error.message}`)
  }
}
