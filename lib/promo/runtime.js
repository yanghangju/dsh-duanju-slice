// Absolute paths for packaged assets and the per-user runtime cache.
// Resolve the package root through junctions rather than relying on the working directory.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
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

/** Default BGM library downloaded during runtime setup, outside the plugin package. */
export const RUNTIME_HOME = join(homedir(), '.dsh', 'plugins', 'dsh-duanju-slice')
export const MUSIC_REVISION = '580270287f984b315ae23554a6996e40d9433567'
export const DEFAULT_MUSIC_DIR = join(RUNTIME_HOME, `music-${MUSIC_REVISION.slice(0, 7)}`)
export const DEFAULT_MUSIC_INDEX = join(DEFAULT_MUSIC_DIR, 'music_library.json')

/**
 * Escape hatch for legacy behaviour and tests that isolate the 剪映 cache or a system
 * FFmpeg: DUANJU_NO_BUNDLED=1 keeps explicit config/paths but ignores packaged assets.
 */
export const BUNDLED_ENABLED = process.env.DUANJU_NO_BUNDLED !== '1'

const isFile = (path) => { try { return statSync(path).isFile() } catch { return false } }
/** Bundled runtime is optional: callers fall back to explicit config or a system tool. */
export const bundled = Object.freeze({
  python: isFile(BUNDLED_PYTHON),
  ffmpeg: isFile(BUNDLED_FFMPEG),
  ffprobe: isFile(BUNDLED_FFPROBE),
  endingSound: isFile(BUNDLED_ENDING_SOUND),
  endingTransition: existsSync(join(BUNDLED_ENDING_TRANSITION, 'AmazingAuto_out', 'xshader', 'generalEffect.json')),
})
