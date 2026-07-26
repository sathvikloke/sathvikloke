// Rewrites the NOW-PLAYING block in README.md from Last.fm.
//
// Runs in GitHub Actions, so LASTFM_API_KEY never leaves the runner.
// Only commits when the rendered block actually changes, so a quiet day
// produces zero commits instead of burying the history in bot noise.
//
// Env: LASTFM_API_KEY, LASTFM_USER

import { readFile, writeFile } from 'node:fs/promises'

const START = '<!-- NOW-PLAYING:START -->'
const END = '<!-- NOW-PLAYING:END -->'
const API = 'https://ws.audioscrobbler.com/2.0/'

const { LASTFM_API_KEY: api_key, LASTFM_USER: user } = process.env
if (!api_key || !user) {
  console.error('Missing LASTFM_API_KEY or LASTFM_USER.')
  process.exit(1)
}

const call = async (params) => {
  const qs = new URLSearchParams({ ...params, api_key, user, format: 'json' })
  const res = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': 'github-profile' } })
  if (!res.ok) throw new Error(`last.fm ${params.method} -> ${res.status}`)
  return res.json()
}

// Markdown table cells break on pipes; links break on brackets.
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/([[\]])/g, '\\$1').trim()

const [recentRaw, topRaw] = await Promise.all([
  call({ method: 'user.getrecenttracks', limit: '5' }),
  call({ method: 'user.gettopartists', limit: '5', period: '1month' }),
])

const raw = recentRaw?.recenttracks?.track
const tracks = Array.isArray(raw) ? raw : raw ? [raw] : []
const live = tracks.find((t) => t['@attr']?.nowplaying === 'true') ?? null

const name = (t) =>
  typeof t.artist === 'string' ? t.artist : (t.artist?.['#text'] ?? t.artist?.name ?? '')

const rows = tracks
  .filter((t) => t !== live)
  .slice(0, 5)
  .map((t) => `| \`${esc(t.name)}\` | ${esc(name(t))} |`)
  .join('\n')

const artists = (topRaw?.topartists?.artist ?? [])
  .map((a) => `\`${esc(a.name)}\``)
  .join(' · ')

const header = live
  ? `### \`♫ now playing\`\n\n**${esc(live.name)}** — ${esc(name(live))}`
  : `### \`♫ last played\`\n\n**${esc(tracks[0]?.name ?? '—')}** — ${esc(name(tracks[0] ?? {}))}`

const block = `${START}

---

<div align="center">

${header}

</div>

| recent | artist |
|---|---|
${rows}

<sub>Top artists this month — ${artists}</sub>

<sub><i>Auto-updated from Last.fm. Scrobbled from Spotify, so it lags a track behind.</i></sub>

${END}`

const path = 'README.md'
const md = await readFile(path, 'utf8')
const a = md.indexOf(START)
const b = md.indexOf(END)
if (a === -1 || b === -1) {
  console.error(`Markers not found in ${path}. Expected ${START} … ${END}`)
  process.exit(1)
}

const next = md.slice(0, a) + block + md.slice(b + END.length)
if (next === md) {
  console.log('No change — leaving README.md alone.')
  process.exit(0)
}

await writeFile(path, next)
console.log(`Updated — ${live ? 'playing' : 'idle'}, ${tracks.length} recent.`)
