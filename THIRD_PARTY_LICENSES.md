# Third-Party Licenses & Legal Notices

**JustChess** is licensed under the **GNU General Public License v3.0 or later (`GPL-3.0-or-later`)** (see [LICENSE](./LICENSE)) to remain fully compliant with its inclusion of the **Stockfish / Stockfish.js** chess engine.

## Runtime (Production) Dependencies

All runtime packages bundled or served to the browser have been audited and are compatible with `GPL-3.0-or-later`:

| Package / Asset | Version | License | GPL-3.0 Compatibility |
| --- | --- | --- | --- |
| [stockfish (Stockfish.js WASM)](https://github.com/nmrugg/stockfish.js) & [Stockfish](https://github.com/official-stockfish/Stockfish) | `19.0.1` | **GPL-3.0** | Native GPL-3.0 |
| [chess.js](https://github.com/jhlywa/chess.js) | `1.4.0` | **BSD-2-Clause** | Compatible |
| [js-chess-engine](https://github.com/josefjadrny/js-chess-engine) | `1.0.2` | **MIT** | Compatible |
| [React](https://react.dev/), `react-dom`, `scheduler` | `19.3.1` / `0.28.0` | **MIT** | Compatible |
| Staunton SVG piece vectors (`src/components/ChessPiece.tsx`) | — | Based on Colin M.L. Burnett's Staunton SVG set (**GPL-2.0+ / CC BY-SA 3.0**) | Compatible |
| Sound effects (`src/utils/chessSounds.ts`) | — | 100% synthesized via Web Audio API (no third-party audio samples) | Original code (GPL-3.0) |

## Development / Build-Time Dependencies

Build-time tools (not shipped as runtime libraries) include **Vite** (`MIT`), **Tailwind CSS** (`MIT`), **TypeScript** (`Apache-2.0`), **Oxlint** (`MIT`), and **LightningCSS** (`MPL-2.0`). All are open-source and compatible with GPL-3.0 workflows.

## Public APIs & Trademark Disclaimer

- **Lichess Public API** (`https://lichess.org/api/games/user/...`, `https://lichess.org/api/cloud-eval`) — read-only public endpoints used upon explicit user action.
- **Chess.com Published-Data API** (`https://api.chess.com/pub/player/...`) — read-only public endpoints used upon explicit user action.
- **Non-Affiliation Notice**: JustChess is an independent open-source project and is **not affiliated with, endorsed by, or sponsored by Lichess.org or Chess.com**. All trademarks belong to their respective owners.

## GPL-3.0 Distribution Checklist

When deploying or distributing JustChess publicly:
1. Keep the [LICENSE](./LICENSE) (GNU GPL v3.0) and this `THIRD_PARTY_LICENSES.md` file included in the repository.
2. Provide access to the corresponding source code of your deployment under `GPL-3.0-or-later`.
3. Retain copyright and license notices for Stockfish, Staunton SVG pieces, and third-party libraries.
