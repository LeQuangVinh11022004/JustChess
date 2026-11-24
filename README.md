# ♞ JustChess

Ứng dụng cờ vua web hiện đại với giao diện lấy cảm hứng từ **Lichess** và **Chess.com**, được xây dựng bằng **Vite + React + TypeScript + Tailwind CSS v4 + chess.js**.

## Tính năng hiện có

- **Bàn cờ chuẩn thi đấu**:
  - Bộ quân cờ **SVG Staunton** sắc nét ở mọi độ phân giải.
  - **3 bảng màu bàn cờ**: *Chess.com Green*, *Lichess Wood*, và *Tournament Blue*.
  - Tọa độ hàng/cột tự động cập nhật khi **xoay bàn cờ** (`⇅ Xoay bàn`).
- **Tương tác mượt mà**:
  - Hỗ trợ cả **kéo-thả (Drag & Drop)** và **nhấp để đi (Click-to-move)**.
  - Highlight nước đi gần nhất, hiệu ứng chiếu đỏ tỏa tròn tại ô Vua, chấm tròn cho nước đi thường và vòng tròn cho nước ăn quân.
  - **Popup chọn quân phong cấp** (Hậu / Xe / Tượng / Mã) ngay trên cột phong cấp.
- **Theo dõi ván đấu & Phân tích**:
  - Thanh thông tin 2 kỳ thủ kèm danh sách **quân đã ăn** và **chênh lệch điểm chất** (`+1`, `+3`, ...).
  - Bảng lịch sử nước đi 2 cột chuẩn đại số (SAN), hỗ trợ **Hoàn tác** và **Ván mới**.
- **Import FEN / PGN & Xem lại (Replay)**:
  - Nạp thế cờ tùy chỉnh từ chuỗi **FEN** (có kiểm tra tính hợp lệ và các thế cờ mẫu).
  - Dán **PGN** từ Lichess / Chess.com (hỗ trợ header `[White]`, `[Black]`, `[Event]`, `[FEN]`) kèm ván mẫu *Opera Game (Paul Morphy, 1858)*.
  - Điều hướng xem lại từng nước đi bằng nút `|<` `<` `>` `>|`, nhấp trực tiếp vào nước đi, hoặc dùng bàn phím.
  - Sao chép nhanh chuỗi **FEN** và **PGN** hiện tại.

## Tech Stack

| Hạng mục | Công nghệ |
| --- | --- |
| Framework & Build | [Vite 8](https://vite.dev/) + [React 19](https://react.dev/) |
| Ngôn ngữ | [TypeScript](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) (`@tailwindcss/vite`) |
| Logic cờ vua | [chess.js](https://github.com/jhlywa/chess.js) |
| Linter | [Oxlint](https://oxc.rs/) |

## Cấu trúc thư mục

```text
JustChess/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── workflows/
│   │   └── ci.yml              # GitHub Actions CI (lint, type-check, build)
│   └── PULL_REQUEST_TEMPLATE.md
├── public/
├── src/
│   ├── components/
│   │   ├── ChessBoard.tsx      # Bàn cờ tương tác (drag-drop, highlight, phong cấp)
│   │   ├── ChessPiece.tsx      # Bộ quân cờ SVG Staunton
│   │   ├── ImportModal.tsx     # Modal nhập FEN / dán PGN
│   │   └── PlayerBar.tsx       # Thanh kỳ thủ, quân đã ăn & điểm chất
│   ├── utils/
│   │   └── boardThemes.ts      # Bảng màu bàn cờ & tính điểm chất
│   ├── App.tsx                 # State ván đấu, replay & layout chính
│   ├── index.css               # Cấu hình Tailwind CSS & style nền
│   └── main.tsx                # Entry point
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── index.html
├── package.json
└── vite.config.ts
```

## Bắt đầu nhanh

### Yêu cầu môi trường

- **Node.js** `>= 20.x` (khuyến nghị Node 22 LTS)
- **npm** `>= 10.x`

### Cài đặt & chạy dự án

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

## Phím tắt khi xem lại ván đấu

| Phím | Chức năng |
| --- | --- |
| `←` | Lùi về nước đi trước |
| `→` | Tiến tới nước đi tiếp theo |
| `Home` | Nhảy về thế cờ ban đầu |
| `End` | Nhảy tới nước đi cuối cùng |

## Roadmap (Định hướng phát triển)

- [x] Âm thanh đi quân, ăn quân, nhập thành, chiếu và kết thúc ván đấu.
- [x] Vẽ mũi tên và đánh dấu ô bằng chuột phải (giống Lichess / Chess.com).
- [x] Đồng hồ đếm ngược (Bullet, Blitz, Rapid, Classical) có cộng giờ (Increment).
- [x] Tích hợp AI **Stockfish WASM** (chơi với máy & thanh đánh giá nước đi).
- [ ] Chế độ chơi Online Realtime (WebSocket).

## Đóng góp

Mọi đóng góp đều được hoan nghênh! Vui lòng đọc kỹ [CONTRIBUTING.md](./CONTRIBUTING.md) và [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) trước khi tạo Issue hoặc Pull Request.

## Giấy phép (License)

Dự án **JustChess** được phát hành theo giấy phép **GNU General Public License v3.0 or later (`GPL-3.0-or-later`)** để tương thích hoàn toàn với engine **Stockfish / Stockfish.js**.

- Xem toàn văn giấy phép tại [LICENSE](./LICENSE).
- Xem danh sách đầy đủ giấy phép và ghi nhận các thư viện bên thứ ba tại [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).
