# Hướng dẫn Đóng góp (Contributing Standard)

Cảm ơn bạn đã quan tâm và muốn đóng góp cho **JustChess**! Tài liệu này quy định quy trình làm việc, tiêu chuẩn mã nguồn, quy ước commit và quy trình review Pull Request nhằm giữ cho dự án sạch sẽ, nhất quán và dễ bảo trì.

Bằng việc tham gia vào dự án, bạn đồng ý tuân thủ [Quy tắc Ứng xử (Code of Conduct)](./CODE_OF_CONDUCT.md).

---

## 1. Quy trình phát triển (Git Workflow)

1. **Tạo Issue trước khi làm tính năng lớn** để thống nhất phạm vi và hướng thiết kế.
2. **Tạo nhánh từ `main`** theo quy ước đặt tên nhánh:
   - `feat/<mo-ta-ngan>`: Thêm tính năng mới (VD: `feat/chess-clock`, `feat/stockfish-eval`)
   - `fix/<mo-ta-ngan>`: Sửa lỗi (VD: `fix/pgn-black-start-turn`)
   - `refactor/<mo-ta-ngan>`: Tái cấu trúc mã nguồn không đổi hành vi
   - `docs/<mo-ta-ngan>`: Cập nhật tài liệu
   - `chore/<mo-ta-ngan>`: Cấu hình build, dependencies, CI/CD
   - `test/<mo-ta-ngan>`: Bổ sung hoặc cập nhật test
3. **Giữ Pull Request gọn và tập trung**: Mỗi PR chỉ nên giải quyết một vấn đề hoặc một tính năng rõ ràng.
4. **Đồng bộ nhánh mới nhất** (`git rebase main` hoặc `git merge main`) trước khi gửi PR để tránh xung đột.

---

## 2. Quy chuẩn Commit (Conventional Commits)

Dự án áp dụng chuẩn [Conventional Commits v1.0.0](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Các loại `<type>` hợp lệ

| Type | Ý nghĩa |
| --- | --- |
| `feat` | Tính năng mới cho người dùng |
| `fix` | Sửa lỗi (bug fix) |
| `docs` | Chỉ thay đổi tài liệu (`README.md`, comments, ...) |
| `style` | Thay đổi định dạng, CSS thuần không ảnh hưởng logic |
| `refactor` | Tái cấu trúc code không thêm tính năng hay sửa bug |
| `perf` | Cải thiện hiệu năng |
| `test` | Thêm hoặc chỉnh sửa bài kiểm thử |
| `chore` | Cập nhật tooling, build, package, cấu hình |

### Ví dụ commit tốt

```text
feat(board): add right-click arrow annotation overlay
fix(import): preserve custom FEN header when loading PGN
refactor(app): extract replay controls into dedicated component
docs(readme): add keyboard shortcuts table
```

---

## 3. Tiêu chuẩn Mã nguồn (Coding Standards)

### TypeScript & React
- **Strict TypeScript**: Không dùng `any` trừ khi thực sự bất khả kháng và có comment giải thích. Luôn khai báo rõ kiểu cho `props`, state phức tạp và hàm tiện ích.
- **Functional Components & Hooks**: Sử dụng function components và React hooks chuẩn. Tránh mutate trực tiếp state.
- **State cờ vua bất biến (Immutable Replay Model)**:
  - Toàn bộ lịch sử nước đi được quản lý qua `(startFen, moves, viewIndex)` và tái tạo trạng thái bàn cờ ở từng ply bằng `chess.js`.
  - Khi bổ sung tính năng mới (phân tích, đồng hồ, âm thanh), hãy bám theo mô hình này để đảm bảo Undo / Replay / Import FEN-PGN luôn đồng bộ.
- **Tổ chức file**:
  - `src/components/`: Các UI component tái sử dụng (`PascalCase.tsx`).
  - `src/utils/`: Các hàm thuần (pure functions), constants, cấu hình theme (`camelCase.ts`).
  - `src/hooks/`: Custom React hooks khi logic state tách riêng (`use*.ts`).

### Styling (Tailwind CSS v4)
- Ưu tiên utility classes của Tailwind CSS; hạn chế viết CSS tùy chỉnh nếu Tailwind đã hỗ trợ.
- Giữ nhất quán bảng màu tối chủ đạo (`#161512`, `#211f1c`, `#262421`, `#302e2b`, accent `#81b64c`).
- Đảm bảo giao diện hoạt động tốt trên cả màn hình Desktop và Mobile (responsive).

### Accessibility & UX
- Các nút chỉ có biểu tượng (icon-only buttons) bắt buộc có `aria-label` hoặc `title` rõ ràng.
- Khi thêm phím tắt bàn phím, luôn bỏ qua sự kiện nếu người dùng đang gõ trong `input`, `textarea`, hoặc modal đang mở.

---

## 4. Kiểm tra bắt buộc trước khi tạo Pull Request

Trước khi push code và mở PR, hãy chắc chắn tất cả các lệnh sau chạy thành công với **0 lỗi và 0 cảnh báo**:

```bash
# Kiểm tra linter (Oxlint)
npm run lint

# Kiểm tra TypeScript (tsc -b) và build production (Vite)
npm run build
```

Ngoài ra, hãy tự kiểm thử thủ công trên trình duyệt (`npm run dev`):
- Kéo-thả và click-to-move trên bàn cờ (cả góc nhìn Trắng và Đen).
- Phong cấp tốt, nhập thành, bắt tốt qua đường (en passant), chiếu và chiếu hết.
- Import FEN hợp lệ / không hợp lệ và dán PGN để xem lại bằng nút điều khiển lẫn phím mũi tên.

---

## 5. Quy trình Pull Request & Review

1. Mở PR bằng mẫu có sẵn trong [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md).
2. Mô tả rõ: **Mục đích thay đổi**, **Cách kiểm thử**, và đính kèm **ảnh chụp màn hình / GIF** nếu có thay đổi UI.
3. PR cần vượt qua toàn bộ kiểm tra lint/build và nhận ít nhất 1 phản hồi chấp thuận (Approve) trước khi merge.
4. Sử dụng **Squash and Merge** để lịch sử commit trên nhánh `main` luôn gọn gàng.

---

## 6. Báo lỗi & Đề xuất tính năng

- **Báo lỗi (Bug Report)**: Dùng mẫu [Bug Report](./.github/ISSUE_TEMPLATE/bug_report.md), cung cấp đầy đủ các bước tái hiện, chuỗi FEN/PGN gây lỗi (nếu có) và ảnh chụp màn hình.
- **Đề xuất tính năng (Feature Request)**: Dùng mẫu [Feature Request](./.github/ISSUE_TEMPLATE/feature_request.md), mô tả rõ bài toán và giá trị mang lại cho người chơi.
