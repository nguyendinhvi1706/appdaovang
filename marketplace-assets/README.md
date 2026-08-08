# Marketplace assets — EA & chỉ báo cho MetaTrader 5

Các file trong thư mục này để đăng lên mục **Marketplace** của AppDaoVang, cho người dùng tải về **tự kiểm chứng** trong MT5.

## Quan điểm

Không file nào ở đây được quảng cáo là "có lợi nhuận". Mục đích duy nhất: đưa công cụ để mỗi người **tự chạy Strategy Tester trên dữ liệu của chính broker mình dùng**, rồi tự quyết định. Thấy có lợi thế thì dùng, không thì bỏ.

Lý do làm vậy: chính dự án này đã kiểm chứng khách quan bốn phương pháp phổ biến (Lưới 369, SMC, SK System, ICT) và **không phương pháp nào chứng minh được lợi thế thống kê** trên XAUUSD khung ngắn. Quảng cáo lợi nhuận mà không có bằng chứng là điều dự án này được xây ra để chống lại.

---

## AppDaoVang_SetupAPlus.mq5

EA triển khai **Setup A+ (SMC)** theo đúng chuỗi: Liquidity Sweep → CHOCH → Order Block → FVG → Pullback.

### Logic vào lệnh

| Bước | Điều kiện |
|---|---|
| 1 | Xu hướng H4 phải rõ ràng: **HH + HL** (chỉ Buy) hoặc **LL + LH** (chỉ Sell) |
| 2 | Gom vùng thanh khoản: **PDH/PDL** + các swing high/low gần đây |
| 3 | **Liquidity Sweep** — nến thủng qua mốc thanh khoản rồi *đóng cửa trở lại* bên trong |
| 4 | **CHOCH** — giá phải phá swing ngược chiều gần nhất trước cú quét. Chưa phá thì cú quét chỉ là nhiễu, **không vào lệnh** |
| 5 | **Order Block** = nến ngược chiều *cuối cùng* ngay trước cú đẩy phá cấu trúc |
| 6 | **FVG** — khoảng trống 3 nến sinh ra trong cú đẩy, chưa bị giá lấp |
| 7 | OB và FVG phải **liền kề** (mặc định ≤ 0.5×ATR). Lưu ý: trong cú đẩy sạch, FVG nằm *ngay trên* thân nến OB chứ không đè lên nó — nên điều kiện là liền kề, không phải chồng lấp |
| 8 | Đặt **lệnh chờ** tại rìa Order Block, huỷ nếu quá `InpPendingBars` nến chưa khớp |
| 9 | **SL ngoài đáy/đỉnh cú quét** (không đặt sát OB vì rất dễ bị quét lại), tối thiểu 1.5×ATR |
| 10 | **TP tại vùng thanh khoản đối diện** (PDH/PDL hoặc swing cũ) đạt RR 1:1.5–1:8. Không có mục tiêu cấu trúc hợp lý thì **không vào lệnh**, không bịa mức TP cố định |

### Quản lý vốn tích hợp

- Khối lượng tính tự động theo `% vốn rủi ro` và khoảng SL thật (không phải lot cố định)
- Dừng giao dịch khi lỗ quá `X%` trong ngày
- Giới hạn số lệnh mỗi ngày

### Cài đặt

1. Copy file `.mq5` vào `MQL5/Experts/` trong thư mục dữ liệu MT5 (MT5 → File → Open Data Folder)
2. Mở **MetaEditor** → mở file → bấm **Compile** (F7)
3. Quay lại MT5, kéo EA vào chart

### Bắt buộc trước khi dùng tiền thật

Chạy **Strategy Tester** trên nhiều năm dữ liệu, chất lượng "Every tick based on real ticks", đúng cặp tiền và đúng broker bạn định dùng. Rồi nhìn:

- **Profit Factor** và **Expectancy**, không phải chỉ Win Rate
- **Số lệnh** — dưới 100 lệnh thì mọi kết luận đều vô nghĩa về mặt thống kê
- **Max Drawdown** và **chuỗi thua dài nhất** — bạn có chịu nổi không?
- Chia đôi giai đoạn: kết quả nửa sau có giống nửa đầu không? Nếu chỉ nửa đầu đẹp thì đó là khớp nhiễu quá khứ

### Cảnh báo

- EA chưa được kiểm chứng có lợi thế. Tác giả **không** khẳng định nó sinh lời.
- Code chưa được biên dịch thử trong môi trường tạo ra nó — hãy compile và test kỹ.
- Giao dịch có đòn bẩy có thể mất toàn bộ vốn.
- Đây không phải lời khuyên đầu tư.
