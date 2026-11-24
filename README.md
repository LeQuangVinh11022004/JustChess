# ♞ JustChess

<p align="center">
  <strong><a href="#english">🇬🇧 English</a></strong> &nbsp;|&nbsp; <strong><a href="#tiếng-việt">🇻🇳 Tiếng Việt</a></strong>
</p>

---

<a id="english"></a>

## 🇬🇧 English

**JustChess** is a modern, open-source web chess application inspired by **Lichess** and **Chess.com**, built with **Vite 8 + React 19 + TypeScript + Tailwind CSS v4 + chess.js + Stockfish 19 WASM + Maia-3 ONNX**.

### Key Features

- **Tournament-Grade Interactive Board**:
  - Crisp **SVG Staunton** chess pieces at any resolution.
  - **3 Board Themes**: *Emerald Classic*, *Walnut Wood*, and *Tournament Blue*.
  - Smooth **Drag & Drop** and **Click-to-Move**, inline pawn promotion picker, board flip, right-click square highlights & arrow drawing (including L-shaped knight arrows).
  - Non-destructive **variation branching** during replay — try alternative lines without losing the main game.
  - Responsive **Mobile & Tablet touch controls** (dedicated replay & flip bar right below the board, zero auto-scroll jumps).
- **Multi-Engine Analysis & Play vs Bot**:
  - **Stockfish 19 WASM** (~3600+ Elo NNUE) running locally in your browser with MultiPV lines, best-move arrows, and a live Evaluation Bar (`1-0` / `0-1` / `½-½` on game end).
  - **Maia-3 ONNX** human-like neural network (1100–1900 Elo) running locally via WebAssembly/ONNX Runtime Web with IndexedDB caching.
  - **Lichess Cloud Eval** (depth 30–60+ opening theory) + **Stockfish vs Maia Compare** mode.
  - **Play vs Bot**: 10 presets spanning Maia 1100–1900 and Stockfish 1000–3600+.
- **Full Game Review (Coach & Analytics)**:
  - 10 move classifications: **Brilliant (`!!`)**, **Great (`!`)**, **Best (`★`)**, **Excellent**, **Good**, **Book**, **Inaccuracy (`?!`)**, **Mistake (`?`)**, **Miss (`×`)**, and **Blunder (`??`)** with on-board badges.
  - **Lichess volatility-weighted Accuracy %**, **ACPL**, **Win-Rate Graph**, and **Key Moments** quick-jump strip.
  - **Overall & 3-Phase Breakdown** (*Opening*, *Middlegame*, *Endgame*) with click-to-jump navigation.
  - **Objective Cross-Platform Game Rating** across **FIDE**, **Chess.com**, and **Lichess** calibrated for *Bullet*, *Blitz*, *Rapid*, and *Classical*.
  - Concrete **Coach Commentary** with opponent refutation & recommended engine lines.
- **Online Game Import, PGN / FEN & Audio**:
  - Search and load recent games + player profiles (Title, Elo, official FIDE rating) directly from **Chess.com** and **Lichess** public APIs.
  - Import/export **FEN** & **PGN** (with built-in *Opera Game, Paul Morphy 1858* sample).
  - Real recorded chess sound effects (move, capture, castle, check, checkmate/game over) decoded via Web Audio API.
  - **Bilingual UI**: instant **Vietnamese / English (`VI / EN`)** toggle in the header.

### Tech Stack

| Category | Technology |
| --- | --- |
| Framework & Build | [Vite 8](https://vite.dev/) + [React 19](https://react.dev/) |
| Language | [TypeScript](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) (`@tailwindcss/vite`) |
| Chess Rules | [chess.js](https://github.com/jhlywa/chess.js) |
| Chess Engines | [Stockfish 19 WASM](https://github.com/official-stockfish/Stockfish) + [Maia-3 ONNX](https://maiachess.com/) (`onnxruntime-web`) |
| Linter | [Oxlint](https://oxc.rs/) |

### Getting Started

#### Prerequisites

- **Node.js** `>= 20.x` (Node 22 LTS recommended)
- **npm** `>= 10.x`

#### Installation & Scripts

```bash
# 1. Install dependencies (automatically syncs Stockfish WASM assets)
npm install

# 2. Start development server (HMR)
npm run dev

# 3. Run linter
npm run lint

# 4. Type-check & build for production
npm run build

# 5. Preview production build
npm run preview
```

### Keyboard Shortcuts (Replay)

| Key | Action |
| --- | --- |
| `←` | Previous move |
| `→` | Next move |
| `↑` / `Home` | Jump to start of game |
| `↓` / `End` | Jump to last move |

### Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before opening an Issue or Pull Request.

### License

**JustChess** is released under the **GNU General Public License v3.0 or later (`GPL-3.0-or-later`)** for full compatibility with **Stockfish** and **Maia Chess**.

- Full license text: [LICENSE](./LICENSE)
- Third-party licenses & attributions: [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)

---

<a id="tiếng-việt"></a>

## 🇻🇳 Tiếng Việt

**JustChess** là ứng dụng cờ vua web mã nguồn mở lấy cảm hứng từ **Lichess** và **Chess.com**, được xây dựng bằng **Vite 8 + React 19 + TypeScript + Tailwind CSS v4 + chess.js + Stockfish 19 WASM + Maia-3 ONNX**.

### Tính năng nổi bật

- **Bàn cờ chuẩn thi đấu & tối ưu Mobile/Tablet**:
  - Bộ quân cờ **SVG Staunton** sắc nét ở mọi độ phân giải.
  - **3 bảng màu bàn cờ**: *Emerald Classic*, *Walnut Wood* và *Tournament Blue*.
  - Hỗ trợ cả **kéo-thả (Drag & Drop)** và **nhấp để đi (Click-to-move)**, popup chọn quân phong cấp ngay trên cột phong cấp, vẽ mũi tên & đánh dấu ô bằng chuột phải.
  - **Rẽ nhánh biến thử** không phá vỡ ván chính khi xem lại; thanh điều khiển tua nước đi cảm ứng lớn đặt ngay dưới bàn cờ trên điện thoại/tablet.
- **Đa Engine phân tích & Đấu với Bot**:
  - **Stockfish 19 WASM** (~3600+ Elo NNUE) chạy trực tiếp trên trình duyệt kèm MultiPV, mũi tên gợi ý và thanh Evaluation Bar (`1-0` / `0-1` / `½-½` khi kết thúc ván).
  - **Maia-3 ONNX** mô phỏng nước đi người thật (1100–1900 Elo) chạy cục bộ và tự lưu cache IndexedDB.
  - **Lichess Cloud Eval** (depth 30–60+) + chế độ **So sánh Stockfish vs Maia**.
  - **Đấu với Bot**: 10 cấp độ từ Maia 1100–1900 đến Stockfish 1000–3600+.
- **Chấm điểm toàn ván (Game Review)**:
  - 10 mức phân loại nước đi: **Thiên tài (`!!`)**, **Xuất sắc (`!`)**, **Tốt nhất (`★`)**, **Rất tốt**, **Tốt**, **Sách khai cuộc**, **Thiếu chính xác (`?!`)**, **Sai lầm (`?`)**, **Bỏ lỡ (`×`)** và **Nghiêm trọng (`??`)** kèm huy hiệu trực tiếp trên bàn cờ.
  - **Accuracy %** (chuẩn Lichess), **ACPL**, **Biểu đồ Win-Rate** và danh sách **Bước ngoặt chính**.
  - Đánh giá **Overall & 3 giai đoạn** (*Khai cuộc*, *Trung cuộc*, *Tàn cuộc*) bấm để nhảy trực tiếp tới từng giai đoạn.
  - **Ước lượng Game Rating khách quan** theo 3 hệ thống **FIDE / Chess.com / Lichess** cho 4 thể loại *Bullet / Blitz / Rapid / Classical*.
  - **HLV nhận xét cụ thể** kèm nhánh phản công của đối thủ và phương án tối ưu.
- **Tải ván Online, FEN/PGN, Âm thanh & Song ngữ**:
  - Tìm và tải ván đấu + hồ sơ kỳ thủ (Danh hiệu, Elo, hệ số FIDE) trực tiếp từ **Chess.com** và **Lichess**.
  - Nhập/xuất **FEN** & **PGN** (kèm ván mẫu *Opera Game — Paul Morphy, 1858*).
  - Âm thanh cờ vua thực tế (đi quân, ăn quân, nhập thành, chiếu, chiếu hết/hết ván) phát mượt qua Web Audio API.
  - **Song ngữ Tiếng Việt / Tiếng Anh (`VI / EN`)** chuyển đổi trực tiếp trên thanh tiêu đề.

### Bắt đầu nhanh

```bash
# 1. Cài đặt dependencies
npm install

# 2. Chạy môi trường phát triển (HMR)
npm run dev

# 3. Kiểm tra lint
npm run lint

# 4. Kiểm tra TypeScript & build production
npm run build

# 5. Xem trước bản build production
npm run preview
```

### Phím tắt khi xem lại ván đấu

| Phím | Chức năng |
| --- | --- |
| `←` | Lùi về nước đi trước |
| `→` | Tiến tới nước đi tiếp theo |
| `↑` / `Home` | Nhảy về đầu ván |
| `↓` / `End` | Nhảy tới nước đi cuối cùng |

### Đóng góp & Giấy phép

- Vui lòng xem [CONTRIBUTING.md](./CONTRIBUTING.md) và [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) trước khi đóng góp.
- Dự án phát hành theo giấy phép **GNU General Public License v3.0 or later (`GPL-3.0-or-later`)** — xem [LICENSE](./LICENSE) và [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).
