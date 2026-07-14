# AppDaoVang — Trading Workspace (Giai đoạn 1)

Nền tảng giao dịch mã nguồn mở. Giai đoạn 1: Trading Workspace miễn phí 100%.

## Tính năng
- Đăng ký / Đăng nhập (JWT)
- Dashboard tổng quan
- Quản lý nhiều tài khoản MT5
- Watchlist
- Biểu đồ TradingView
- Lịch kinh tế (TradingView widget)
- Tin tức Forex (RSS FXStreet)
- Giá vàng XAUUSD realtime
- Nhật ký giao dịch + upload ảnh lệnh

## Công nghệ
- **Web:** Next.js 14, React 18, Tailwind CSS, TypeScript
- **API:** NestJS 10, Prisma, PostgreSQL, JWT
- **Hạ tầng:** pnpm workspaces, Turborepo, Docker

## Chạy dự án

```bash
# 1. Cài đặt
corepack enable && pnpm install

# 2. Khởi động PostgreSQL + Redis
docker compose up -d

# 3. Cấu hình môi trường
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 4. Tạo database
pnpm db:generate && pnpm db:migrate

# 5. Chạy dev (web: http://localhost:3000, api: http://localhost:3001)
pnpm dev
```

## Cấu trúc
```
apps/
 ├── web    # Next.js frontend
 └── api    # NestJS backend
packages/
 └── shared # Types dùng chung
```

## Tiến độ 8 giai đoạn

- ✅ GĐ1 Trading Workspace — auth, dashboard, MT5 accounts, watchlist, chart, lịch kinh tế, tin tức, giá vàng, nhật ký
- ✅ GĐ2 AI Trader — chat phân tích bằng dữ liệu thật (Ollama/OpenAI), `/api/ai/chat`
- ✅ GĐ3 Smart Money Concept — BOS/CHOCH/OB/FVG/EQH-EQL/Premium-Discount/Session/Kill Zone trên Lightweight Charts
- ✅ GĐ4 Backtest — 3 chiến lược, win rate/drawdown/profit factor/expectancy, equity curve + Replay chart
- ✅ GĐ5 Trading Journal — ảnh trước/sau, cảm xúc, lỗi; AI tổng hợp điểm yếu theo phiên/thứ/cảm xúc
- ✅ GĐ6 Risk Manager — lot size, RR, margin, pip value, profit, drawdown
- ✅ GĐ7 Copy Strategy — chia sẻ chiến lược/template/indicator/journal/backtest, áp dụng 1 chạm
- ✅ GĐ8 Marketplace — indicator, EA, template, script, AI prompt, journal; upload file, rating, download

Hướng phát triển tiếp: MT5 Gateway (đồng bộ lệnh thật), import dữ liệu nến CSV cho backtest dài hạn, i18n, Docker hóa toàn bộ app.
