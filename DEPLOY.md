# Deploy miễn phí — dùng trên điện thoại không cần bật máy tính

Kiến trúc: **Vercel** (web) + **Render** (API) + **Neon** (PostgreSQL) + **Groq** (AI) — tất cả free tier.

## Bước 0 — Đưa code lên GitHub (bắt buộc)

```bash
cd appdaovang
git init
git add .
git commit -m "AppDaoVang v1"
```
Tạo repo mới trên github.com → làm theo hướng dẫn "push an existing repository":
```bash
git remote add origin https://github.com/<username>/appdaovang.git
git branch -M main
git push -u origin main
```

## Bước 1 — Database: Neon (free)

1. Đăng ký https://neon.tech (đăng nhập bằng GitHub)
2. Create project → đặt tên `appdaovang` → region Singapore
3. Copy **connection string** dạng `postgresql://...@....neon.tech/neondb?sslmode=require`

## Bước 2 — AI: Groq (free)

1. Đăng ký https://console.groq.com
2. API Keys → Create API Key → copy key `gsk_...`

(Groq chạy Llama 3.3 70B miễn phí — thông minh hơn hẳn llama3.2 3B chạy local.)

## Bước 3 — API: Render (free)

1. Đăng ký https://render.com bằng GitHub
2. New + → **Blueprint** → chọn repo `appdaovang` (Render tự đọc `render.yaml`)
3. Điền các biến được hỏi:
   - `DATABASE_URL` = connection string Neon (bước 1)
   - `AI_API_KEY` = key Groq (bước 2)
   - `CORS_ORIGIN` = tạm để `*`, sửa lại sau bước 4
4. Deploy → chờ ~5 phút → được URL dạng `https://appdaovang-api.onrender.com`
5. Kiểm tra: mở `https://appdaovang-api.onrender.com/api/market/gold` thấy JSON giá vàng là OK

## Bước 4 — Web: Vercel (free)

1. Đăng ký https://vercel.com bằng GitHub
2. Add New → Project → import repo `appdaovang`
3. **Root Directory**: chọn `apps/web`
4. Environment Variables:
   - `NEXT_PUBLIC_API_URL` = URL Render (bước 3), VD `https://appdaovang-api.onrender.com`
5. Deploy → được URL dạng `https://appdaovang.vercel.app`
6. Quay lại Render → Environment → sửa `CORS_ORIGIN` = URL Vercel → Save (tự redeploy)

## Bước 5 — Dùng trên điện thoại

Mở `https://appdaovang.vercel.app` trên trình duyệt điện thoại → đăng ký tài khoản mới (DB cloud trống, tài khoản localhost không tự chuyển) → **Thêm vào màn hình chính** (Add to Home Screen) để dùng như app.

## Bước 6 — Báo lệnh qua Telegram (tùy chọn)

1. Trên Telegram, chat với **@BotFather** → gõ `/newbot` → đặt tên hiển thị và username (phải kết thúc bằng `bot`, VD `appdaovang_bot`)
2. BotFather trả về một **token** dạng `123456:ABC-...` → copy lại, và ghi nhớ **username** (không có `@`)
3. Vào Render → API service → Environment → thêm:
   - `TELEGRAM_BOT_TOKEN` = token vừa lấy
   - `TELEGRAM_BOT_USERNAME` = username bot (không `@`)
4. Save → Render tự redeploy. Vào app → mục **AI Trader → Setup lệnh** → bấm "🔗 Kết nối Telegram" → bot sẽ tự nhắn xác nhận khi liên kết xong
5. Từ giờ mỗi lần tạo setup mới, khớp entry, thắng hoặc thua đều có tin nhắn báo tự động — kể cả lúc không mở app (server tự quét nền mỗi ~90 giây trong lúc đang thức)

Nếu để trống 2 biến trên, mục Telegram trong app tự ẩn, không ảnh hưởng gì đến các tính năng khác.

## Giới hạn free tier cần biết

- **Render free ngủ sau 15 phút không dùng** → lần mở đầu chờ ~30-50 giây cho API thức dậy. Mẹo: dùng https://uptimerobot.com (free) ping URL API mỗi 10 phút để không ngủ.
- **Ảnh upload (nhật ký, marketplace) sẽ MẤT khi Render redeploy** (disk tạm). Khắc phục sau bằng Cloudinary free nếu cần giữ ảnh lâu dài.
- Neon free: 0.5GB — thoải mái cho journal + setup.
- Groq free: ~14k request/ngày — dư dùng cá nhân.

## Cập nhật app sau này

```bash
git add . && git commit -m "update" && git push
```
Vercel + Render tự deploy lại khi push. Xong.
