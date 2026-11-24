import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js'
import { useState } from 'react'

export type ImportTab = 'fen' | 'pgn'

interface ImportModalProps {
  initialTab?: ImportTab
  currentFen: string
  onImportFen: (fen: string) => void
  onImportPgn: (pgn: string) => void
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

export function ImportModal({
  initialTab = 'fen',
  currentFen,
  onImportFen,
  onImportPgn,
  onClose,
}: ImportModalProps) {
  const [tab, setTab] = useState<ImportTab>(initialTab)
  const [fenInput, setFenInput] = useState(currentFen)
  const [pgnInput, setPgnInput] = useState('')
  const [error, setError] = useState<string | null>(null)

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
        err instanceof Error ? `FEN không hợp lệ: ${err.message}` : 'Không thể tải chuỗi FEN này.',
      )
    }
  }

  const handleLoadPgn = () => {
    const trimmed = pgnInput.trim()
    if (!trimmed) {
      setError('Vui lòng dán nội dung PGN vào ô bên trên.')
      return
    }

    try {
      const testGame = new Chess()
      testGame.loadPgn(trimmed)
      onImportPgn(trimmed)
      onClose()
    } catch (err) {
      setError(
        err instanceof Error
          ? `PGN không hợp lệ: ${err.message}`
          : 'Không thể đọc PGN này. Hãy kiểm tra lại ký hiệu nước đi.',
      )
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-[#262421] shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#211f1c] px-5 py-3.5">
          <h2 className="text-base font-bold text-white">
            Tải thế cờ (FEN) / Xem lại ván đấu (PGN)
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
        <div className="grid grid-cols-2 border-b border-white/10 bg-[#1e1c1a] p-1.5">
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
            Chuỗi FEN (Thế cờ)
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
            Dán PGN (Xem lại ván đấu)
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {tab === 'fen' ? (
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
          ) : (
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

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#302e2b] px-4 py-2 text-xs font-semibold text-stone-300 transition hover:bg-[#3d3a36]"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={tab === 'fen' ? handleLoadFen : handleLoadPgn}
              className="rounded-lg bg-[#81b64c] px-4 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d]"
            >
              {tab === 'fen' ? 'Tải thế cờ FEN' : 'Tải ván PGN để xem'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
