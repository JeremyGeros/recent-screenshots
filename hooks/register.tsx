import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'

const RECENT_MS = 2 * 60 * 1000
const MAX_SHOTS = 5
const THUMBS = '/tmp/claude-recent-screenshots'
const SCREENSHOT = /^(Screenshot|Screen Shot) .+\.png$/
const TILE_W = 96
const TILE_H = 60
const PIXELS = 2
const ACCENT = '#d97757'

const shots = atom({ plugin: 'recent-screenshots', key: 'shots' } as const, [], {
  shape: 'shots-2',
})
const attached = atom({ plugin: 'recent-screenshots', key: 'attached' } as const, [])
const dismissed = atom({ plugin: 'recent-screenshots', key: 'dismissed' } as const, [])
const sent = atom({ plugin: 'recent-screenshots', key: 'sent' } as const, [], {
  shape: 'sent-1',
})

const thumbnail = async ($: EngineInterface, path: string, mtimeMs: number): Promise<Shot> => {
  const out = `${THUMBS}/${mtimeMs}.jpg`
  const { stdout } = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path])
  const [width = 1, height = 1] = [...stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map(m => Number(m[1]))
  const scale = Math.min(1, Math.max((TILE_W * PIXELS) / width, (TILE_H * PIXELS) / height))
  const [w, h] = [Math.round(width * scale), Math.round(height * scale)]
  const crop = [Math.min(h, TILE_H * PIXELS), Math.min(w, TILE_W * PIXELS)].map(String)
  await $.process.run(['sips', '-z', String(h), String(w), '-c', ...crop, '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', path, '--out', out])
  const { base64 } = await $.fs.read(out, { as: 'bytes' })

  return { path, mtimeMs, thumb: `data:image/jpeg;base64,${base64}` }
}

const tile = (thumb: string, isAdded: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}" viewBox="0 0 ${TILE_W} ${TILE_H}">` +
  `<defs><clipPath id="c"><rect width="${TILE_W}" height="${TILE_H}" rx="6"/></clipPath></defs>` +
  `<image href="${thumb}" width="${TILE_W}" height="${TILE_H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>` +
  (isAdded
    ? `<rect x="1" y="1" width="${TILE_W - 2}" height="${TILE_H - 2}" rx="5" fill="none" stroke="${ACCENT}" stroke-width="2"/>`
    : `<rect x="0.5" y="0.5" width="${TILE_W - 1}" height="${TILE_H - 1}" rx="5.5" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>`) +
  `</svg>`

const forget = async ($: EngineInterface, paths: string[]) => {
  await update($, dismissed, list => [...list, ...paths])
  await update($, attached, list => list.filter(p => !paths.includes(p)))
  await update($, shots, list => list.filter(s => !paths.includes(s.path)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const custom = await $.process.run(['defaults', 'read', 'com.apple.screencapture', 'location'])
    const home = await $.env.get('HOME')
    const folder = custom.exitCode === 0 ? custom.stdout.trim().replace(/^~/, home ?? '~') : `${home}/Desktop`
    await $.process.run(['mkdir', '-p', THUMBS])

    const scan = async () => {
      const now = await $.clock.now()
      const hidden = await read($, dismissed)
      const kept = await read($, attached)
      const recent = (await $.fs.list(folder))
        .filter(f => f.kind === 'file' && SCREENSHOT.test(f.name))
        .map(f => ({ path: `${folder}/${f.name}`, mtimeMs: f.mtimeMs }))
        .filter(f => (now - f.mtimeMs < RECENT_MS || kept.includes(f.path)) && !hidden.includes(f.path))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, MAX_SHOTS)
      const current = await read($, shots)
      const isSame =
        recent.length === current.length && recent.every((f, i) => current[i]?.path === f.path)
      if (isSame) return

      const latest = await Promise.all(
        recent.map(f => current.find(s => s.path === f.path) ?? thumbnail($, f.path, f.mtimeMs)),
      )
      await update($, shots, () => latest)
    }

    let isScanning = false
    const tick = () => {
      if (isScanning) return
      isScanning = true
      void scan().finally(() => (isScanning = false))
    }
    $.clock.every(2000, tick)
    tick()

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const paths = await read($, attached)
    if (paths.length === 0 || e.command || e.isMeta) return next(e)

    const thumbs = (await read($, shots)).filter(s => paths.includes(s.path)).map(s => s.thumb)
    await update($, sent, list => [...list, { text: e.text, thumbs }].slice(-20))
    await forget($, paths)
    const note = `The user attached ${paths.length === 1 ? 'a screenshot' : `${paths.length} screenshots`} to this prompt. Read each image before answering:\n${paths.join('\n')}`

    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const message = (await read($, sent)).findLast(m => m.text === e.props.text)
    const row = await next(e)
    if (e.surface !== 'desktop' || message === undefined) return row

    const { Box, Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" alignItems="flex-end" gap={1}>
        {row}
        <Box flexDirection="row" gap={1}>
          {message.thumbs.map((thumb, i) => (
            <Svg source={tile(thumb, false)} alt={`Screenshot ${i + 1}`} width={TILE_W} height={TILE_H} />
          ))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, shots)
    if (e.surface !== 'desktop' || e.props.hasSurvey || list.length === 0) return next(e)

    const added = await read($, attached)
    const { Box, Markdown, Text } = $.ui.resolve(e)
    // Only Button and Markdown links take clicks, and a Button can't hold an
    // image, so each tile is a markdown image wrapped in a link to its thumbnail.
    const hrefOf = (shot: Shot) => `file://${THUMBS}/${shot.mtimeMs}.jpg`
    const images = list.map(shot => {
      const svg = encodeURIComponent(tile(shot.thumb, added.includes(shot.path)))
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')

      return `[![Screenshot](data:image/svg+xml;charset=utf-8,${svg})](${hrefOf(shot)})`
    })

    return (
      <Box flexDirection="row" gap={2} alignItems="center">
        <Text dimColor>Recent screenshots</Text>
        <Markdown
          key="shots"
          text={images.join(' ')}
          pressableLinks={list.map(hrefOf)}
          onLinkPress={link => {
            const shot = list.find(s => hrefOf(s) === link.href)
            if (shot === undefined) return

            void update($, attached, l =>
              l.includes(shot.path) ? l.filter(p => p !== shot.path) : [...l, shot.path],
            )
          }}
        />
      </Box>
    )
  })
}
