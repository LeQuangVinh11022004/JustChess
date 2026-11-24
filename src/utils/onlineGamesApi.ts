export type OnlinePlatform = 'lichess' | 'chesscom'

export interface OnlinePlayerProfile {
  platform: OnlinePlatform
  username: string
  name?: string
  title?: string
  avatar?: string
  fideRating?: number
  ratings: {
    bullet?: number
    blitz?: number
    rapid?: number
    classical?: number
  }
}

export interface OnlineGameSummary {
  id: string
  platform: OnlinePlatform
  whiteName: string
  whiteTitle?: string
  whiteRating?: number
  blackName: string
  blackTitle?: string
  blackRating?: number
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  userOutcome: 'win' | 'loss' | 'draw' | 'unknown'
  userColor: 'w' | 'b'
  timeControl: string
  dateLabel: string
  pgn: string
  url?: string
}

function formatDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

interface LichessGameJson {
  id?: string
  speed?: string
  createdAt?: number
  winner?: 'white' | 'black'
  pgn?: string
  players?: {
    white?: { user?: { name?: string; title?: string }; rating?: number }
    black?: { user?: { name?: string; title?: string }; rating?: number }
  }
}

async function fetchLichessGames(
  username: string,
  limit = 15,
): Promise<OnlineGameSummary[]> {
  const cleanUser = username.trim()
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(cleanUser)}?max=${limit}&pgnInJson=true&clocks=false&evals=false`

  const res = await fetch(url, {
    headers: { Accept: 'application/x-ndjson' },
  })

  if (res.status === 404) {
    throw new Error(`Không tìm thấy tài khoản Lichess "${cleanUser}".`)
  }
  if (!res.ok) {
    throw new Error(`Lichess API lỗi (${res.status}). Vui lòng thử lại sau.`)
  }

  const rawText = await res.text()
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const lowerUser = cleanUser.toLowerCase()
  const games: OnlineGameSummary[] = []

  for (const line of lines) {
    try {
      const item = JSON.parse(line) as LichessGameJson
      if (!item.pgn) continue

      const whiteName = item.players?.white?.user?.name ?? 'Anonymous'
      const blackName = item.players?.black?.user?.name ?? 'Anonymous'
      const userColor: 'w' | 'b' =
        blackName.toLowerCase() === lowerUser ? 'b' : 'w'

      const result: OnlineGameSummary['result'] =
        item.winner === 'white'
          ? '1-0'
          : item.winner === 'black'
            ? '0-1'
            : '1/2-1/2'

      let userOutcome: OnlineGameSummary['userOutcome'] = 'draw'
      if (item.winner === 'white') {
        userOutcome = userColor === 'w' ? 'win' : 'loss'
      } else if (item.winner === 'black') {
        userOutcome = userColor === 'b' ? 'win' : 'loss'
      }

      games.push({
        id: item.id ?? `lichess-${games.length}`,
        platform: 'lichess',
        whiteName,
        whiteTitle: item.players?.white?.user?.title,
        whiteRating: item.players?.white?.rating,
        blackName,
        blackTitle: item.players?.black?.user?.title,
        blackRating: item.players?.black?.rating,
        result,
        userOutcome,
        userColor,
        timeControl: item.speed ?? 'standard',
        dateLabel: item.createdAt ? formatDate(item.createdAt) : '',
        pgn: item.pgn,
        url: item.id ? `https://lichess.org/${item.id}` : undefined,
      })
    } catch {
      // Skip malformed NDJSON line
    }
  }

  return games
}

interface ChessComGameJson {
  url?: string
  pgn?: string
  time_class?: string
  end_time?: number
  rules?: string
  white?: { username?: string; rating?: number; result?: string }
  black?: { username?: string; rating?: number; result?: string }
}

async function fetchChessComGames(
  username: string,
  limit = 15,
): Promise<OnlineGameSummary[]> {
  const cleanUser = username.trim().toLowerCase()
  const archivesUrl = `https://api.chess.com/pub/player/${encodeURIComponent(cleanUser)}/games/archives`

  const archivesRes = await fetch(archivesUrl)
  if (archivesRes.status === 404) {
    throw new Error(`Không tìm thấy tài khoản Chess.com "${username.trim()}".`)
  }
  if (!archivesRes.ok) {
    throw new Error(
      `Chess.com API lỗi (${archivesRes.status}). Vui lòng thử lại sau.`,
    )
  }

  const archivesData = (await archivesRes.json()) as { archives?: string[] }
  const archives = archivesData.archives ?? []
  if (archives.length === 0) {
    return []
  }

  // Fetch up to the latest 2 monthly archives until we have `limit` standard games
  const collected: OnlineGameSummary[] = []
  const recentArchives = archives.slice(-2).reverse()

  for (const archiveUrl of recentArchives) {
    const monthRes = await fetch(archiveUrl)
    if (!monthRes.ok) continue
    const monthData = (await monthRes.json()) as { games?: ChessComGameJson[] }
    const monthGames = [...(monthData.games ?? [])].reverse()

    for (const g of monthGames) {
      if (!g.pgn || (g.rules && g.rules !== 'chess')) continue

      const whiteName = g.white?.username ?? 'White'
      const blackName = g.black?.username ?? 'Black'
      const userColor: 'w' | 'b' =
        blackName.toLowerCase() === cleanUser ? 'b' : 'w'

      const whiteWon = g.white?.result === 'win'
      const blackWon = g.black?.result === 'win'
      const result: OnlineGameSummary['result'] = whiteWon
        ? '1-0'
        : blackWon
          ? '0-1'
          : '1/2-1/2'

      let userOutcome: OnlineGameSummary['userOutcome'] = 'draw'
      if (whiteWon) {
        userOutcome = userColor === 'w' ? 'win' : 'loss'
      } else if (blackWon) {
        userOutcome = userColor === 'b' ? 'win' : 'loss'
      }

      collected.push({
        id: g.url ?? `chesscom-${collected.length}`,
        platform: 'chesscom',
        whiteName,
        whiteRating: g.white?.rating,
        blackName,
        blackRating: g.black?.rating,
        result,
        userOutcome,
        userColor,
        timeControl: g.time_class ?? 'standard',
        dateLabel: g.end_time ? formatDate(g.end_time * 1000) : '',
        pgn: g.pgn,
        url: g.url,
      })

      if (collected.length >= limit) break
    }

    if (collected.length >= limit) break
  }

  return collected
}

export async function fetchOnlineUserGames(
  platform: OnlinePlatform,
  username: string,
  limit = 15,
): Promise<OnlineGameSummary[]> {
  if (!username.trim()) {
    throw new Error('Vui lòng nhập tên tài khoản.')
  }
  return platform === 'lichess'
    ? fetchLichessGames(username, limit)
    : fetchChessComGames(username, limit)
}

interface ChessComProfileJson {
  username?: string
  name?: string
  title?: string
  avatar?: string
}

interface ChessComStatsJson {
  fide?: number
  chess_bullet?: { last?: { rating?: number } }
  chess_blitz?: { last?: { rating?: number } }
  chess_rapid?: { last?: { rating?: number } }
  chess_daily?: { last?: { rating?: number } }
}

interface LichessProfileJson {
  username?: string
  title?: string
  profile?: {
    firstName?: string
    lastName?: string
    fideRating?: number
  }
  perfs?: {
    bullet?: { rating?: number }
    blitz?: { rating?: number }
    rapid?: { rating?: number }
    classical?: { rating?: number }
  }
}

export async function fetchOnlinePlayerProfile(
  platform: OnlinePlatform,
  username: string,
): Promise<OnlinePlayerProfile | null> {
  const clean = username.trim()
  if (!clean) return null

  try {
    if (platform === 'chesscom') {
      const lower = encodeURIComponent(clean.toLowerCase())
      const [profileRes, statsRes] = await Promise.all([
        fetch(`https://api.chess.com/pub/player/${lower}`),
        fetch(`https://api.chess.com/pub/player/${lower}/stats`),
      ])
      if (!profileRes.ok) return null
      const profile = (await profileRes.json()) as ChessComProfileJson
      const stats = statsRes.ok
        ? ((await statsRes.json()) as ChessComStatsJson)
        : undefined

      return {
        platform: 'chesscom',
        username: profile.username ?? clean,
        name: profile.name,
        title: profile.title,
        avatar: profile.avatar,
        fideRating: stats?.fide && stats.fide > 0 ? stats.fide : undefined,
        ratings: {
          bullet: stats?.chess_bullet?.last?.rating,
          blitz: stats?.chess_blitz?.last?.rating,
          rapid: stats?.chess_rapid?.last?.rating,
          classical: stats?.chess_daily?.last?.rating,
        },
      }
    }

    const res = await fetch(
      `https://lichess.org/api/user/${encodeURIComponent(clean)}`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as LichessProfileJson
    const fullName = [data.profile?.firstName, data.profile?.lastName]
      .filter(Boolean)
      .join(' ')

    return {
      platform: 'lichess',
      username: data.username ?? clean,
      name: fullName || undefined,
      title: data.title,
      fideRating:
        data.profile?.fideRating && data.profile.fideRating > 0
          ? data.profile.fideRating
          : undefined,
      ratings: {
        bullet: data.perfs?.bullet?.rating,
        blitz: data.perfs?.blitz?.rating,
        rapid: data.perfs?.rapid?.rating,
        classical: data.perfs?.classical?.rating,
      },
    }
  } catch {
    return null
  }
}
