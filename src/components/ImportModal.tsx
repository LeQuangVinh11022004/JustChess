import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js'
import { useState } from 'react'
import {
  fetchOnlineUserGames,
  type OnlineGameSummary,
  type OnlinePlatform,
} from '../utils/onlineGamesApi'

export type ImportTab = 'online' | 'pgn' | 'fen'

interface ImportModalProps {
  initialTab?: ImportTab
  currentFen: string
  onImportFen: (fen: string) => void
  onImportPgn: (pgn: string, autoReview?: boolean) => void
  onImportOnlineGame: (game: OnlineGameSummary) => void
  onClose: () => void
}

const SAMPLE_FENS = [
  {
    label: 'Thế cờ chuẩn',
    fen: DEFAULT_POSITION,
  },
  {
    label: 'Chiếu hết 1 nước (Trắng)',
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  },
  {
    label: 'Tàn cuộc Vua + Xe',
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
  },
]

const SAMPLE_PGN = `[Event "Opera Game"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6
7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7
12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8
17. Rd8# 1-0`

const QUICK_USERS: Record<OnlinePlatform, string[]> = {
  chesscom: ['MagnusCarlsen', 'Hikaru', 'GothamChess'],
  lichess: ['DrNykterstein', 'alireza2003', 'Penguingim1'],
}

export function ImportModal({
  initialTab = 'online',
  currentFen,
  onImportFen,
  onImportPgn,
  onImportOnlineGame,
  onClose,
}: ImportModalProps) {
  const [tab, setTab] = useState<ImportTab>(initialTab)
  const [fenInput, setFenInput] = useState(currentFen)
  const [pgnInput, setPgnInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Online Lichess / Chess.com search state
  const [platform, setPlatform] = useState<OnlinePlatform>('chesscom')
  const [username, setUsername] = useState('')
  const [isLoadingGames, setIsLoadingGames] = useState(false)
  const [onlineGames, setOnlineGames] = useState<OnlineGameSummary[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  const handleLoadFen = () => {
    const trimmed = fenInput.trim()
    if (!trimmed) {
      setError('Vui lòng nhập chuỗi FEN.')
      return
    }

    const result = validateFen(trimmed)
    if (!result.ok) {
      setError(`FEN không hợp lệ: ${result.error ?? 'Sai định dạng.'}`)
      return
    }

    try {
      const testGame = new Chess()
      testGame.load(trimmed)
      onImportFen(testGame.fen())
      onClose()
    } catch (err) {
      setError(
        err instanceof Error
          ? `FEN không hợp lệ: ${err.message}`
          : 'Không thể tải chuỗi FEN này.',
      )
    }
  }

  const handleLoadPgn = (autoReview = false) => {
    const trimmed = pgnInput.trim()
    if (!trimmed) {
      setError('Vui lòng dán nội dung PGN vào ô bên trên.')
      return
    }

    try {
      const testGame = new Chess()
      testGame.loadPgn(trimmed)
      onImportPgn(trimmed, autoReview)
      onClose()
    } catch (err) {
      setError(
        err instanceof Error
          ? `PGN không hợp lệ: ${err.message}`
          : 'Không thể đọc PGN này. Hãy kiểm tra lại ký hiệu nước đi.',
      )
    }
  }

  const handleSearchOnline = async (
    targetPlatform = platform,
    targetUser = username,
  ) => {
    const clean = targetUser.trim()
    if (!clean) {
      setError('Vui lòng nhập tên tài khoản Lichess hoặc Chess.com.')
      return
    }

    setError(null)
    setIsLoadingGames(true)
    setHasSearched(true)
    try {
      const games = await fetchOnlineUserGames(targetPlatform, clean, 15)
      setOnlineGames(games)
      if (games.length === 0) {
        setError(`Không tìm thấy ván cờ tiêu chuẩn nào gần đây của "${clean}".`)
      }
    } catch (err) {
      setOnlineGames([])
      setError(
        err instanceof Error
          ? err.message
          : 'Không thể tải danh sách ván đấu. Hãy thử lại.',
      )
    } finally {
      setIsLoadingGames(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl bg-[#262421] shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#211f1c] px-5 py-3.5">
          <h2 className="text-base font-bold text-white">
            Tải ván đấu &amp; Thế cờ
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-md px-2 py-1 text-sm text-stone-400 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-3 border-b border-white/10 bg-[#1e1c1a] p-1.5">
          <button
            type="button"
            onClick={() => {
              setTab('online')
              setError(null)
            }}
            className={[
              'rounded-lg py-2 text-xs font-semibold transition',
              tab === 'online'
                ? 'bg-[#302e2b] text-white shadow-sm'
                : 'text-stone-400 hover:text-stone-200',
            ].join(' ')}
          >
            🔍 Lichess / Chess.com
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('pgn')
              setError(null)
            }}
            className={[
              'rounded-lg py-2 text-xs font-semibold transition',
              tab === 'pgn'
                ? 'bg-[#302e2b] text-white shadow-sm'
                : 'text-stone-400 hover:text-stone-200',
            ].join(' ')}
          >
            Dán PGN
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('fen')
              setError(null)
            }}
            className={[
              'rounded-lg py-2 text-xs font-semibold transition',
              tab === 'fen'
                ? 'bg-[#302e2b] text-white shadow-sm'
                : 'text-stone-400 hover:text-stone-200',
            ].join(' ')}
          >
            Chuỗi FEN
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {tab === 'online' && (
            <div className="flex flex-col gap-3">
              {/* Platform switcher + search bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleSearchOnline()
                }}
                className="flex flex-wrap gap-2"
              >
                <div className="flex rounded-lg bg-[#161512] p-1 ring-1 ring-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setPlatform('chesscom')
                      setOnlineGames([])
                      setHasSearched(false)
                      setError(null)
                    }}
                    className={[
                      'rounded-md px-2.5 py-1.5 text-xs font-semibold transition',
                      platform === 'chesscom'
                        ? 'bg-[#81b64c] text-[#161512]'
                        : 'text-stone-400 hover:text-stone-200',
                    ].join(' ')}
                  >
                    Chess.com
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlatform('lichess')
                      setOnlineGames([])
                      setHasSearched(false)
                      setError(null)
                    }}
                    className={[
                      'rounded-md px-2.5 py-1.5 text-xs font-semibold transition',
                      platform === 'lichess'
                        ? 'bg-stone-100 text-[#161512]'
                        : 'text-stone-400 hover:text-stone-200',
                    ].join(' ')}
                  >
                    Lichess
                  </button>
                </div>

                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setError(null)
                  }}
                  placeholder={
                    platform === 'chesscom'
                      ? 'Nhập username Chess.com (VD: Hikaru)...'
                      : 'Nhập username Lichess (VD: DrNykterstein)...'
                  }
                  className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-[#161512] px-3 py-2 text-xs text-stone-100 placeholder:text-stone-500 focus:border-[#81b64c] focus:outline-none"
                />

                <button
                  type="submit"
                  disabled={isLoadingGames}
                  className="rounded-lg bg-[#81b64c] px-4 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d] disabled:opacity-50"
                >
                  {isLoadingGames ? 'Đang tìm...' : 'Tìm ván'}
                </button>
              </form>

              {/* Quick sample accounts */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-stone-500">Thử nhanh:</span>
                {QUICK_USERS[platform].map((sampleUser) => (
                  <button
                    key={sampleUser}
                    type="button"
                    onClick={() => {
                      setUsername(sampleUser)
                      void handleSearchOnline(platform, sampleUser)
                    }}
                    className="rounded-md bg-[#302e2b] px-2 py-1 text-[11px] font-medium text-stone-300 transition hover:bg-[#3d3a36] hover:text-white"
                  >
                    {sampleUser}
                  </button>
                ))}
              </div>

              {/* Games List */}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-[#161512] p-1.5">
                {isLoadingGames ? (
                  <div className="py-10 text-center text-xs text-stone-400">
                    Đang tải danh sách ván đấu gần nhất từ{' '}
                    {platform === 'chesscom' ? 'Chess.com' : 'Lichess'}...
                  </div>
                ) : onlineGames.length === 0 ? (
                  <div className="py-10 text-center text-xs text-stone-500">
                    {hasSearched
                      ? 'Chưa có ván đấu nào để hiển thị.'
                      : 'Nhập tên tài khoản rồi bấm Tìm ván — chỉ cần 1 cú click để tải và phân tích ngay!'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {onlineGames.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          onImportOnlineGame(g)
                          onClose()
                        }}
                        className="group flex items-center justify-between gap-3 rounded-lg bg-[#211f1c] px-3 py-2 text-left transition hover:bg-[#302e2b]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="truncate font-semibold text-stone-100">
                              ♔ {g.whiteName}
                            </span>
                            {g.whiteRating && (
                              <span className="font-mono text-[10px] text-stone-500">
                                ({g.whiteRating})
                              </span>
                            )}
                            <span className="text-stone-600">vs</span>
                            <span className="truncate font-semibold text-stone-300">
                              ♚ {g.blackName}
                            </span>
                            {g.blackRating && (
                              <span className="font-mono text-[10px] text-stone-500">
                                ({g.blackRating})
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-stone-500">
                            <span className="uppercase">{g.timeControl}</span>
                            <span>•</span>
                            <span>{g.result}</span>
                            {g.dateLabel && (
                              <>
                                <span>•</span>
                                <span>{g.dateLabel}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={[
                              'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                              g.userOutcome === 'win'
                                ? 'bg-[#81b64c]/20 text-[#a3d160]'
                                : g.userOutcome === 'loss'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-stone-700/60 text-stone-300',
                            ].join(' ')}
                          >
                            {g.userOutcome === 'win'
                              ? 'Thắng'
                              : g.userOutcome === 'loss'
                                ? 'Thua'
                                : 'Hòa'}
                          </span>
                          <span className="rounded bg-[#81b64c] px-2 py-1 text-[11px] font-bold text-[#161512] opacity-85 transition group-hover:opacity-100">
                            Phân tích
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'fen' && (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-medium text-stone-300">
                Nhập chuỗi FEN
                <input
                  type="text"
                  value={fenInput}
                  onChange={(e) => {
                    setFenInput(e.target.value)
                    setError(null)
                  }}
                  placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#161512] px-3 py-2.5 font-mono text-xs text-stone-100 placeholder:text-stone-600 focus:border-[#81b64c] focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-stone-500">Mẫu nhanh:</span>
                {SAMPLE_FENS.map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    onClick={() => {
                      setFenInput(sample.fen)
                      setError(null)
                    }}
                    className="rounded-md bg-[#302e2b] px-2 py-1 text-[11px] font-medium text-stone-300 transition hover:bg-[#3d3a36] hover:text-white"
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'pgn' && (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-medium text-stone-300">
                Dán nội dung PGN (hỗ trợ cả header từ Lichess / Chess.com)
                <textarea
                  rows={8}
                  value={pgnInput}
                  onChange={(e) => {
                    setPgnInput(e.target.value)
                    setError(null)
                  }}
                  placeholder={'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 ...'}
                  className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-[#161512] p-3 font-mono text-xs text-stone-100 placeholder:text-stone-600 focus:border-[#81b64c] focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPgnInput(SAMPLE_PGN)
                    setError(null)
                  }}
                  className="rounded-md bg-[#302e2b] px-2.5 py-1 text-[11px] font-medium text-stone-300 transition hover:bg-[#3d3a36] hover:text-white"
                >
                  Dùng ván mẫu: Opera Game (Paul Morphy, 1858)
                </button>
                <span className="text-[11px] text-stone-500">
                  Mẹo: Dùng phím ← / → để xem từng nước
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {tab !== 'online' && (
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-[#302e2b] px-4 py-2 text-xs font-semibold text-stone-300 transition hover:bg-[#3d3a36]"
              >
                Hủy
              </button>
              {tab === 'pgn' && (
                <button
                  type="button"
                  onClick={() => handleLoadPgn(true)}
                  className="rounded-lg bg-[#302e2b] px-4 py-2 text-xs font-semibold text-[#a3d160] ring-1 ring-[#81b64c]/40 transition hover:bg-[#3d3a36]"
                >
                  Tải &amp; Phân tích ngay
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  tab === 'fen' ? handleLoadFen() : handleLoadPgn(false)
                }
                className="rounded-lg bg-[#81b64c] px-4 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d]"
              >
                {tab === 'fen' ? 'Tải thế cờ FEN' : 'Tải ván PGN'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
