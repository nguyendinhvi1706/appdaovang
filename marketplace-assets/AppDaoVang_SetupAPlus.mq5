//+------------------------------------------------------------------+
//|                                     AppDaoVang_SetupAPlus.mq5     |
//|  Setup A+ (SMC): Liquidity Sweep -> CHOCH -> Order Block + FVG    |
//|                                                                   |
//|  EA NAY DE KIEM CHUNG, KHONG PHAI DE HUA HEN LOI NHUAN.           |
//|  Hay chay Strategy Tester tren du lieu that cua chinh broker ban  |
//|  dung, nhieu nam, roi tu quyet dinh. Neu khong co loi the thi bo. |
//+------------------------------------------------------------------+
#property copyright "AppDaoVang - open source"
#property link      "https://github.com/nguyendinhvi1706/appdaovang"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//--- Tham so
input group "=== Quan ly von ==="
input double InpRiskPercent      = 1.0;    // % von rui ro moi lenh
input double InpDailyLossStopPct = 5.0;    // Dung giao dich khi lo qua % nay trong ngay (0 = tat)
input int    InpMaxTradesPerDay  = 5;      // So lenh toi da moi ngay (0 = khong gioi han)

input group "=== Cau truc ==="
input int    InpSwingLookback    = 2;      // So nen 2 ben de xac nhan swing
input int    InpSweepLookback    = 24;     // Tim cu quet thanh khoan trong bao nhieu nen gan nhat
input double InpMinSlAtr         = 1.5;    // SL toi thieu = he so nay x ATR
input double InpBufferAtr        = 0.5;    // Dem SL ngoai diem quet = he so nay x ATR
input double InpConfluenceAtr    = 0.5;    // OB va FVG phai cach nhau <= he so nay x ATR

input group "=== Muc tieu ==="
input double InpMinRR            = 1.5;    // RR toi thieu chap nhan
input double InpMaxRR            = 8.0;    // RR toi da (tranh muc tieu vien vong)
input int    InpPendingBars      = 96;     // Huy lenh cho sau bao nhieu nen chua khop

input group "=== Khac ==="
input int    InpATRPeriod        = 14;
input ulong  InpMagic            = 20260805;
input int    InpSlippage         = 30;

//--- Bien toan cuc
CTrade   trade;
int      hATR = INVALID_HANDLE;
datetime lastBarTime = 0;
datetime pendingPlacedAt = 0;
double   dayStartBalance = 0;
int      tradesToday = 0;
int      currentDay = -1;

//+------------------------------------------------------------------+
int OnInit()
{
   hATR = iATR(_Symbol, PERIOD_CURRENT, InpATRPeriod);
   if(hATR == INVALID_HANDLE)
   {
      Print("Khong tao duoc handle ATR");
      return(INIT_FAILED);
   }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   if(hATR != INVALID_HANDLE) IndicatorRelease(hATR);
}

//+------------------------------------------------------------------+
//| Tien ich                                                          |
//+------------------------------------------------------------------+
double ATRValue()
{
   double buf[];
   if(CopyBuffer(hATR, 0, 1, 1, buf) <= 0) return(0.0);
   return(buf[0]);
}

bool IsNewBar()
{
   datetime t = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(t == lastBarTime) return(false);
   lastBarTime = t;
   return(true);
}

//--- swing high: nen shift co high cao nhat trong cua so 2*lb+1
bool IsSwingHigh(int shift, int lb)
{
   double h = iHigh(_Symbol, PERIOD_CURRENT, shift);
   for(int k = 1; k <= lb; k++)
   {
      if(iHigh(_Symbol, PERIOD_CURRENT, shift + k) > h) return(false);
      if(iHigh(_Symbol, PERIOD_CURRENT, shift - k) > h) return(false);
   }
   return(true);
}

bool IsSwingLow(int shift, int lb)
{
   double l = iLow(_Symbol, PERIOD_CURRENT, shift);
   for(int k = 1; k <= lb; k++)
   {
      if(iLow(_Symbol, PERIOD_CURRENT, shift + k) < l) return(false);
      if(iLow(_Symbol, PERIOD_CURRENT, shift - k) < l) return(false);
   }
   return(true);
}

//--- Xu huong H4 theo cau truc HH+HL / LL+LH. Tra ve 1 = tang, -1 = giam, 0 = khong ro
int H4Trend()
{
   int lb = InpSwingLookback;
   double highs[2]; double lows[2];
   int nh = 0, nl = 0;
   for(int s = lb + 1; s < 200 && (nh < 2 || nl < 2); s++)
   {
      double h = iHigh(_Symbol, PERIOD_H4, s);
      double l = iLow(_Symbol, PERIOD_H4, s);
      bool sh = true, sl = true;
      for(int k = 1; k <= lb; k++)
      {
         if(iHigh(_Symbol, PERIOD_H4, s + k) > h || iHigh(_Symbol, PERIOD_H4, s - k) > h) sh = false;
         if(iLow(_Symbol, PERIOD_H4, s + k) < l || iLow(_Symbol, PERIOD_H4, s - k) < l) sl = false;
      }
      if(sh && nh < 2) { highs[nh] = h; nh++; }
      if(sl && nl < 2) { lows[nl] = l; nl++; }
   }
   if(nh < 2 || nl < 2) return(0);
   // highs[0] moi hon highs[1]
   bool hh = highs[0] > highs[1];
   bool hl = lows[0]  > lows[1];
   bool ll = lows[0]  < lows[1];
   bool lh = highs[0] < highs[1];
   if(hh && hl) return(1);
   if(ll && lh) return(-1);
   return(0);
}

//--- PDH/PDL: dinh/day ngay giao dich truoc
bool PreviousDayLevels(double &pdh, double &pdl)
{
   int shift = 1; // nen D1 da dong gan nhat
   pdh = iHigh(_Symbol, PERIOD_D1, shift);
   pdl = iLow(_Symbol, PERIOD_D1, shift);
   return(pdh > 0 && pdl > 0);
}

//+------------------------------------------------------------------+
//| Tim setup A+                                                      |
//| Tra ve true neu du dieu kien; dien entry/sl/tp va huong           |
//+------------------------------------------------------------------+
bool FindSetup(bool &isBuy, double &entry, double &sl, double &tp)
{
   int trend = H4Trend();
   if(trend == 0) return(false);
   isBuy = (trend > 0);

   double atr = ATRValue();
   if(atr <= 0) return(false);

   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double minSlDist = MathMax(atr * InpMinSlAtr, iClose(_Symbol, PERIOD_CURRENT, 1) * 0.001);

   //--- BUOC 2: gom vung thanh khoan (PDH/PDL + swing cu)
   double pdh = 0, pdl = 0;
   PreviousDayLevels(pdh, pdl);

   double pools[32];
   int nPools = 0;
   if(isBuy && pdl > 0) { pools[nPools] = pdl; nPools++; }
   if(!isBuy && pdh > 0) { pools[nPools] = pdh; nPools++; }

   int lb = InpSwingLookback;
   for(int s = lb + 1; s < 200 && nPools < 30; s++)
   {
      if(isBuy && IsSwingLow(s, lb))  { pools[nPools] = iLow(_Symbol, PERIOD_CURRENT, s);  nPools++; }
      if(!isBuy && IsSwingHigh(s, lb)) { pools[nPools] = iHigh(_Symbol, PERIOD_CURRENT, s); nPools++; }
   }
   if(nPools == 0) return(false);

   //--- BUOC 3: tim cu quet thanh khoan gan nhat
   int sweepShift = -1;
   double sweepExtreme = 0;
   for(int s = 1; s <= InpSweepLookback; s++)
   {
      double lo = iLow(_Symbol, PERIOD_CURRENT, s);
      double hi = iHigh(_Symbol, PERIOD_CURRENT, s);
      double cl = iClose(_Symbol, PERIOD_CURRENT, s);
      bool swept = false;
      for(int p = 0; p < nPools; p++)
      {
         if(isBuy  && lo < pools[p] && cl > pools[p]) { swept = true; break; }
         if(!isBuy && hi > pools[p] && cl < pools[p]) { swept = true; break; }
      }
      if(swept) { sweepShift = s; sweepExtreme = (isBuy ? lo : hi); break; }
   }
   if(sweepShift < 2) return(false); // can it nhat vai nen sau cu quet

   //--- BUOC 4: CHOCH - pha swing nguoc chieu gan nhat TRUOC cu quet
   double chochLevel = 0;
   bool found = false;
   for(int s = sweepShift + 1; s < sweepShift + 100; s++)
   {
      if(isBuy && IsSwingHigh(s, lb))  { chochLevel = iHigh(_Symbol, PERIOD_CURRENT, s); found = true; break; }
      if(!isBuy && IsSwingLow(s, lb))  { chochLevel = iLow(_Symbol, PERIOD_CURRENT, s);  found = true; break; }
   }
   if(!found) return(false);

   int breakShift = -1;
   for(int s = sweepShift - 1; s >= 1; s--)
   {
      if(isBuy  && iHigh(_Symbol, PERIOD_CURRENT, s) > chochLevel) { breakShift = s; break; }
      if(!isBuy && iLow(_Symbol, PERIOD_CURRENT, s)  < chochLevel) { breakShift = s; break; }
   }
   if(breakShift < 0) return(false); // chua pha cau truc -> cu quet chi la nhieu

   //--- BUOC 5: Order Block = nen nguoc chieu CUOI CUNG truoc cu day pha cau truc
   int obShift = -1;
   for(int s = breakShift + 1; s <= sweepShift; s++)
   {
      bool bearish = iClose(_Symbol, PERIOD_CURRENT, s) < iOpen(_Symbol, PERIOD_CURRENT, s);
      if(isBuy ? bearish : !bearish) { obShift = s; break; }
   }
   if(obShift < 0) return(false);

   double obTop    = MathMax(iOpen(_Symbol, PERIOD_CURRENT, obShift), iClose(_Symbol, PERIOD_CURRENT, obShift));
   double obBottom = MathMin(iOpen(_Symbol, PERIOD_CURRENT, obShift), iClose(_Symbol, PERIOD_CURRENT, obShift));

   //--- BUOC 6: FVG trong cu day (khoang trong 3 nen), chua bi lap
   double fvgTop = 0, fvgBottom = 0;
   bool haveFvg = false;
   for(int s = breakShift; s <= sweepShift && s >= 1; s++)
   {
      // FVG tang: low[s] > high[s+2]
      if(isBuy)
      {
         double a = iLow(_Symbol, PERIOD_CURRENT, s);
         double b = iHigh(_Symbol, PERIOD_CURRENT, s + 2);
         if(a > b)
         {
            // kiem tra chua bi lap boi cac nen sau do
            bool alive = true;
            for(int k = s - 1; k >= 1; k--)
               if(iLow(_Symbol, PERIOD_CURRENT, k) <= b) { alive = false; break; }
            if(alive) { fvgTop = a; fvgBottom = b; haveFvg = true; break; }
         }
      }
      else
      {
         double a = iHigh(_Symbol, PERIOD_CURRENT, s);
         double b = iLow(_Symbol, PERIOD_CURRENT, s + 2);
         if(a < b)
         {
            bool alive = true;
            for(int k = s - 1; k >= 1; k--)
               if(iHigh(_Symbol, PERIOD_CURRENT, k) >= b) { alive = false; break; }
            if(alive) { fvgTop = b; fvgBottom = a; haveFvg = true; break; }
         }
      }
   }
   if(!haveFvg) return(false);

   //--- BUOC 7-8: OB va FVG phai LIEN KE (hop luu). Luu y: trong mot cu day sach, FVG nam
   //--- ngay tren than nen OB chu khong de len no, nen KHONG bat buoc chong lap.
   double gap = isBuy ? (fvgBottom - obTop) : (obBottom - fvgTop);
   if(gap > atr * InpConfluenceAtr) return(false);

   entry = isBuy ? obTop : obBottom;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(isBuy && entry >= bid) return(false);   // gia da hoi qua vung
   if(!isBuy && entry <= ask) return(false);

   //--- BUOC 9: SL ngoai DAY/DINH CU QUET (khong dat sat Order Block)
   sl = isBuy ? (sweepExtreme - atr * InpBufferAtr) : (sweepExtreme + atr * InpBufferAtr);
   if(MathAbs(entry - sl) < minSlDist)
      sl = isBuy ? (entry - minSlDist) : (entry + minSlDist);

   double slDist = MathAbs(entry - sl);
   if(slDist <= 0) return(false);

   //--- BUOC 10: TP tai vung thanh khoan doi dien, RR trong khoang cho phep
   double bestTp = 0; double bestRR = 0;
   double targets[32]; int nT = 0;
   if(isBuy && pdh > 0) { targets[nT] = pdh; nT++; }
   if(!isBuy && pdl > 0) { targets[nT] = pdl; nT++; }
   for(int s = lb + 1; s < 200 && nT < 30; s++)
   {
      if(isBuy && IsSwingHigh(s, lb)) { targets[nT] = iHigh(_Symbol, PERIOD_CURRENT, s); nT++; }
      if(!isBuy && IsSwingLow(s, lb)) { targets[nT] = iLow(_Symbol, PERIOD_CURRENT, s);  nT++; }
   }
   for(int i = 0; i < nT; i++)
   {
      double t = targets[i];
      if(isBuy && t <= entry) continue;
      if(!isBuy && t >= entry) continue;
      double rr = MathAbs(t - entry) / slDist;
      if(rr < InpMinRR || rr > InpMaxRR) continue;
      if(bestRR == 0 || rr < bestRR) { bestRR = rr; bestTp = t; }
   }
   if(bestRR == 0) return(false); // khong co muc tieu cau truc hop ly -> khong vao lenh
   tp = bestTp;

   return(true);
}

//+------------------------------------------------------------------+
//| Tinh khoi luong theo % rui ro                                     |
//+------------------------------------------------------------------+
double CalcLot(double entry, double sl)
{
   double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = balance * InpRiskPercent / 100.0;
   double slDist    = MathAbs(entry - sl);
   if(slDist <= 0) return(0);

   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0 || tickValue <= 0) return(0);

   double lossPerLot = (slDist / tickSize) * tickValue;
   if(lossPerLot <= 0) return(0);

   double lot = riskMoney / lossPerLot;

   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   lot = MathFloor(lot / lotStep) * lotStep;
   if(lot < minLot) lot = 0;          // khong du von de vao lenh dung rui ro -> bo qua
   if(lot > maxLot) lot = maxLot;
   return(lot);
}

//+------------------------------------------------------------------+
bool HasOpenOrPending()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == (long)InpMagic) return(true);
   }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == _Symbol &&
         OrderGetInteger(ORDER_MAGIC) == (long)InpMagic) return(true);
   }
   return(false);
}

void CancelExpiredPending()
{
   if(InpPendingBars <= 0 || pendingPlacedAt == 0) return;
   int barsPassed = Bars(_Symbol, PERIOD_CURRENT, pendingPlacedAt, TimeCurrent());
   if(barsPassed < InpPendingBars) return;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == _Symbol &&
         OrderGetInteger(ORDER_MAGIC) == (long)InpMagic)
      {
         trade.OrderDelete(ticket);
         pendingPlacedAt = 0;
      }
   }
}

//--- Kiem soat rui ro theo ngay
bool RiskGateOpen()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(dt.day != currentDay)
   {
      currentDay = dt.day;
      dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      tradesToday = 0;
   }
   if(InpMaxTradesPerDay > 0 && tradesToday >= InpMaxTradesPerDay) return(false);
   if(InpDailyLossStopPct > 0)
   {
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      double lossPct = (dayStartBalance - equity) / dayStartBalance * 100.0;
      if(lossPct >= InpDailyLossStopPct) return(false);
   }
   return(true);
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(!IsNewBar()) return;      // chi xu ly khi co nen moi dong

   CancelExpiredPending();
   if(HasOpenOrPending()) return;
   if(!RiskGateOpen()) return;

   bool isBuy; double entry, sl, tp;
   if(!FindSetup(isBuy, entry, sl, tp)) return;

   double lot = CalcLot(entry, sl);
   if(lot <= 0) return;

   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   entry = NormalizeDouble(entry, digits);
   sl    = NormalizeDouble(sl, digits);
   tp    = NormalizeDouble(tp, digits);

   bool ok = false;
   if(isBuy) ok = trade.BuyLimit(lot, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, "AppDaoVang A+");
   else      ok = trade.SellLimit(lot, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, "AppDaoVang A+");

   if(ok)
   {
      pendingPlacedAt = TimeCurrent();
      tradesToday++;
      PrintFormat("Dat lenh cho %s: entry %.5f | SL %.5f | TP %.5f | lot %.2f | RR 1:%.2f",
                  (isBuy ? "BUY" : "SELL"), entry, sl, tp, lot,
                  MathAbs(tp - entry) / MathAbs(entry - sl));
   }
   else
   {
      PrintFormat("Dat lenh that bai: %d - %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
   }
}
//+------------------------------------------------------------------+
