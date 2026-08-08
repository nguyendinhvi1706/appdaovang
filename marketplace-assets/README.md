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

---

## AppDaoVang_Breakout.mq5

EA phá vỡ biên độ bằng **Buy Stop / Sell Stop** theo cơ chế OCO (bên nào khớp thì huỷ bên kia).

Đo biên độ theo một trong hai cách: **Donchian** (N nến gần nhất) hoặc **biên độ phiên** (ví dụ phiên Á 00:00–07:00 UTC, rồi đặt lệnh chờ khi London mở cửa). Đặt lệnh cách biên độ một khoảng đệm theo ATR, SL theo ATR, TP theo tỷ lệ RR.

Kèm sẵn: tự tính lot theo % rủi ro, dời SL về hoà vốn khi đạt 1R, trailing stop theo ATR, giới hạn 1 lệnh/ngày, dừng khi lỗ quá X% trong ngày.

Đây thuộc họ **theo đà (momentum)** — nhóm có bằng chứng học thuật tương đối vững nhất trong phân tích kỹ thuật. Nhưng "tương đối vững" không có nghĩa là chắc thắng, và lợi thế nếu có thường nhỏ. Vẫn phải tự backtest.

---

## AppDaoVang_DCA_Grid.mq5

EA **DCA / Grid** có phanh cứng. Đọc kỹ phần dưới trước khi chạy.

### Cảnh báo toán học — quan trọng hơn mọi tính năng

DCA nhân hệ số cho **tỷ lệ thắng rất cao** và đường vốn rất đẹp. Đó không phải bằng chứng nó tốt — đó là bản chất của việc **đổi xác suất thắng cao lấy rủi ro thảm hoạ hiếm gặp**.

Với hệ số nhân 1.3 và 6 tầng, tổng khối lượng khi đủ tầng gấp khoảng **6.7 lần** tầng đầu. Một xu hướng kéo dài không hồi sẽ chạm hết các tầng rồi tiếp tục đi — và mất mát ở tầng cuối lớn gấp nhiều lần toàn bộ lợi nhuận tích luỹ trước đó.

Nói cách khác: **tỷ lệ thắng 95% vẫn có thể lỗ**, nếu 5% còn lại xoá sạch lãi của 95%. Khi đánh giá EA này, đừng nhìn Win Rate — nhìn **Max Drawdown**, **Profit Factor**, và đặc biệt là **điều gì xảy ra trong giai đoạn thị trường có xu hướng mạnh nhất** trong dữ liệu test.

### Phanh cứng đã tích hợp

| Cơ chế | Mặc định |
|---|---|
| **Cắt lỗ toàn rổ** khi lỗ quá % vốn | 10% |
| Số tầng tối đa | 6 |
| Dừng mở rổ mới khi lỗ trong ngày quá % | 5% |
| Kiểm tra ký quỹ tự do trước khi thêm tầng | bắt buộc |
| Bỏ qua khi spread giãn rộng | 100 points |

**Không có chế độ nhân vô hạn.** Nếu bạn đặt `InpBasketStopLossPct = 0` (tắt cắt lỗ toàn rổ), EA sẽ in cảnh báo vào log — đó là cấu hình có thể mất toàn bộ vốn, và là cấu hình mà phần lớn "EA DCA thần thánh" bán trên mạng đang dùng để tạo ra backtest đẹp.

### Bộ lọc vào lệnh

Chỉ mở rổ Buy khi RSI dưới ngưỡng, mở rổ Sell khi RSI trên ngưỡng — tránh mở rổ ngược ngay giữa một cú chạy mạnh.

---

## Cách test cho đúng (áp dụng cho cả ba EA)

1. **Dữ liệu thật, dài**: Strategy Tester, "Every tick based on real ticks", tối thiểu 2–3 năm, đúng broker bạn sẽ dùng
2. **Đủ số lệnh**: dưới 100 lệnh thì mọi kết luận đều là nhiễu
3. **Nhìn đúng chỉ số**: Profit Factor, Expectancy, Max Drawdown — không phải Win Rate
4. **Chia đôi giai đoạn**: kết quả nửa sau có giống nửa đầu không? Nếu chỉ nửa đầu đẹp thì đó là khớp nhiễu quá khứ, thực chiến sẽ thua
5. **Đừng tối ưu tham số cho tới khi đẹp**: thử đủ nhiều tổ hợp thì luôn tìm được bộ số cho lãi trên quá khứ. Đó là cái bẫy phổ biến nhất, và là lý do phần lớn EA có backtest đẹp lại cháy tài khoản khi chạy thật.
