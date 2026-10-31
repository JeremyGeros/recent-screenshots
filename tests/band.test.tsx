import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'recent-screenshots',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const PATH = '/Users/me/Desktop/Screenshot 2026-10-30 at 22.06.03.png'
const LINK = 'file:///tmp/claude-recent-screenshots/900.jpg'

test('a clicked screenshot rides along with the next prompt, then leaves the band', async ($, on) => {
  on('env.get', () => ({ value: '/Users/me' }))
  on('clock.now', () => ({ value: 1_000 }))
  on('process.run', (_, e) => ({ value: { exitCode: e.argv[0] === 'defaults' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: { base64: 'AA==' } }))
  on('fs.list', () => ({
    value: [
      { name: 'Screenshot 2026-10-30 at 22.06.03.png', kind: 'file', size: 1, mtimeMs: 900, isLink: false },
      { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 900, isLink: false },
    ],
  }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  const tiles = await ui.find({ type: 'Markdown', key: 'shots' })
  expect(tiles?.props.pressableLinks).toEqual([LINK])
  await ui.press({ key: 'shots', link: { href: LINK } })
  expect(String((await ui.find({ type: 'Markdown', key: 'shots' }))?.props.text)).toContain('d97757')

  const sent = await $.prompt.submit({ text: 'what is wrong here?', wait: false, origin: { kind: 'composer' } })
  expect(sent.context?.join('\n')).toContain(PATH)
  expect(await ui.find({ type: 'Markdown', key: 'shots' })).toBeUndefined()
  await ui.unmount()
})
