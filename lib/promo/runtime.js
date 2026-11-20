// Bundled portable runtime for this package: relocation-safe absolute paths only.
// Installed packages are often reached through a directory junction, so every
// exported path is derived from the resolved (real) package root, never from a
// drive letter, the NarratoAI install or the current working directory.
import assert from 'node:assert/strict'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

function realPath(path) {
  try { return realpathSync.native(path) } catch { return path }
}

/** Real package root: lib/promo/runtime.js -> package root, junction-free when possible. */
export const PACKAGE_ROOT = realPath(fileURLToPath(new URL('../..', import.meta.url)))

export const RUNTIME_DIR = join(PACKAGE_ROOT, 'runtime')
export const ASSETS_DIR = join(PACKAGE_ROOT, 'assets')

/** Relocated CPython 3.12 (python.exe + python312.dll + Lib + needed site-packages). */
export const BUNDLED_PYTHON = join(RUNTIME_DIR, 'python', 'python.exe')
/** FFmpeg 9.x GPL-3.0-or-later build (libx264) and its FFprobe (LGPL-2.1-or-later). */
export const BUNDLED_FFMPEG = join(RUNTIME_DIR, 'ffmpeg', 'ffmpeg.exe')
export const BUNDLED_FFPROBE = join(RUNTIME_DIR, 'ffmpeg', 'ffprobe.exe')

/** 剪映「大气片尾声效」 (resourceId 7023776340713164069), original cached file. */
export const BUNDLED_ENDING_SOUND = join(ASSETS_DIR, 'ending', '大气片尾声效.mp3')
/** 剪映「炫光」 native effect root: contains AmazingAuto_out/xshader/generalEffect.json. */
export const BUNDLED_ENDING_TRANSITION = join(ASSETS_DIR, 'ending', '炫光转场')

/** Packaged default BGM library (music_library.json + one audio per description). */
export const DEFAULT_MUSIC_DIR = join(ASSETS_DIR, 'music')
export const DEFAULT_MUSIC_INDEX = join(DEFAULT_MUSIC_DIR, 'music_library.json')

/**
 * Escape hatch for legacy behaviour and tests that isolate the 剪映 cache or a system
 * FFmpeg: DUANJU_NO_BUNDLED=1 keeps explicit config/paths but ignores packaged assets.
 */
export const BUNDLED_ENABLED = process.env.DUANJU_NO_BUNDLED !== '1'

const isFile = (path) => { try { return statSync(path).isFile() } catch { return false } }
const isDirectory = (path) => { try { return statSync(path).isDirectory() } catch { return false } }

/** Bundled runtime is optional: callers fall back to explicit config or a system tool. */
export const bundled = Object.freeze({
  python: isFile(BUNDLED_PYTHON),
  ffmpeg: isFile(BUNDLED_FFMPEG),
  ffprobe: isFile(BUNDLED_FFPROBE),
  endingSound: isFile(BUNDLED_ENDING_SOUND),
  endingTransition: existsSync(join(BUNDLED_ENDING_TRANSITION, 'AmazingAuto_out', 'xshader', 'generalEffect.json')),
  music: isDirectory(DEFAULT_MUSIC_DIR) && isFile(DEFAULT_MUSIC_INDEX),
})

/**
 * Explicit config wins (a real user override); otherwise the packaged library.
 * No implicit NarratoAI/D: fallback and no writes: the packaged tree is shipped read-only material.
 */
export function resolveMusicDir(config) {
  const explicit = config?.bgm?.musicDir
  if (typeof explicit === 'string' && explicit.trim()) return explicit
  return DEFAULT_MUSIC_DIR
}

/** Validate the packaged default library in place; never downloads, creates or repairs it. */
export function ensureBundledMusic() {
  assert(isDirectory(DEFAULT_MUSIC_DIR), `内置默认曲库目录缺失：${DEFAULT_MUSIC_DIR}；请重新安装包含 assets/music 的插件包`)
  assert(isFile(DEFAULT_MUSIC_INDEX), `内置默认曲库缺少 music_library.json：${DEFAULT_MUSIC_INDEX}`)
  return DEFAULT_MUSIC_DIR
}

/** Advanced mode may reuse an explicit library path; otherwise the packaged default. */
export function resolveAdvancedMusicDir(config, override) {
  if (typeof override === 'string' && override.trim()) return override
  const explicit = config?.advanced?.musicDir
  if (typeof explicit === 'string' && explicit.trim()) return explicit
  return ensureBundledMusic()
}
