//+------------------------------------------------------------------+
//|                                     AppDaoVang_Breakout.mq5       |
//|  Breakout bang Buy Stop / Sell Stop — de kiem chung               |
//|                                                                   |
//|  Y tuong: do bien do mot khoang (phien A hoac N nen gan nhat),    |
//|  dat Buy Stop tren dinh va Sell Stop duoi day. Ben nao khop truoc |
//|  thi huy ben con lai (OCO).                                       |
//|                                                                   |
//|  Day thuoc ho THEO DA (momentum) — nhom co bang chung hoc thuat   |
//|  tuong doi vung nhat trong phan tich ky thuat. Nhung "tuong doi   |
//|  vung" khong co nghia la chac thang: van phai tu backtest.        |
//+------------------------------------------------------------------+
#property copyright "AppDaoVang - open source"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

enum ENUM_RANGE_MODE
{
   RANGE_BARS,     // Bien do N nen gan nhat (Donchian)
   RANGE_SESSION   // Bien do phien theo gio (VD phien A)
};

input group "=== Cach do bien do ==="
input ENUM_RANGE_MODE InpRangeMode  = RANGE_BARS;
input int    InpRangeBars           = 20;    // So nen do bien do (che do Donchian)
input int    InpSessionStartHour    = 0;     // Gio bat dau phien (UTC) - che do Session
input int    InpSessionEndHour      = 7;     // Gio ket thuc phien (UTC)
input int    InpTradeStartHour      = 7;     // Chi dat lenh cho tu gio nay (UTC)
input int    InpTradeEndHour        = 15;    // Den gio nay (UTC)

input group "=== Vao lenh ==="
input double InpBufferAtr           = 0.2;   // Dat lenh cho cach bien do bao nhieu x ATR
input double InpSlAtr               = 1.5;   // SL = he so nay x ATR
input double InpRR                  = 2.0;   // TP = RR x khoang SL
input int    InpPendingBars         = 24;    // Huy lenh cho sau bao nhieu nen chua khop
input bool   InpOneTradePerDay      = true;  // Chi 1 lenh moi ngay

input group "=== Quan ly von ==="
input double InpRiskPercent         = 1.0;   // % von rui ro moi lenh
input double InpDailyLossStopPct    = 5.0;   // Dung khi lo qua % nay trong ngay
input bool   InpMoveToBreakeven     = true;  // Doi SL ve hoa von khi dat 1R
input double InpTrailAtr            = 0.0;   // Trailing stop theo ATR (0 = tat)

input group "=== Khac ==="
input int    InpATRPeriod           = 14;
input ulong  InpMagic               = 20260807;
input int    InpSlippage            = 30;

CTrade   trade;
int      hATR = INVALID_HANDLE;
datetime lastBarTime = 0;
datetime pendingPlacedAt = 0;
int      currentDay = -1;
double   dayStartBalance = 0;
bool     tradedToday = false;

//+------------------------------------------------------------------+
int OnInit()
{
   hATR = iATR(_Symbol, PERIOD_CURRENT, InpATRPeriod);
   if(hATR == INVALID_HANDLE) return(INIT_FAILED);
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { if(hATR != INVALID_HANDLE) IndicatorRelease(hATR); }

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

//--- Bien do: Donchian N nen hoac bien do phien
bool GetRange(double &hi, double &lo)
{
   hi = 0; lo = 0;
   if(InpRangeMode == RANGE_BARS)
   {
      int n = InpRangeBars;
      if(n < 3) return(false);
      hi = iHigh(_Symbol, PERIOD_CURRENT, 1);
      lo = iLow(_Symbol, PERIOD_CURRENT, 1);
      for(int s = 2; s <= n; s++)
      {
         double h = iHigh(_Symbol, PERIOD_CURRENT, s);
         double l = iLow(_Symbol, PERIOD_CURRENT, s);
         if(h > hi) hi = h;
         if(l < lo) lo = l;
      }
      return(hi > lo);
   }

   //--- Che do phien: quet cac nen trong khung gio phien cua NGAY HOM NAY
   MqlDateTime now; TimeToStruct(TimeCurrent(), now);
   bool found = false;
   for(int s = 1; s < 500; s++)
   {
      datetime bt = iTime(_Symbol, PERIOD_CURRENT, s);
      if(bt == 0) break;
      MqlDateTime d; TimeToStruct(bt, d);
      if(d.day != now.day) break;                     // sang ngay khac thi dung
      if(d.hour < InpSessionStartHour || d.hour >= InpSessionEndHour) continue;
      double h = iHigh(_Symbol, PERIOD_CURRENT, s);
      double l = iLow(_Symbol, PERIOD_CURRENT, s);
      if(!found) { hi = h; lo = l; found = true; }
      else { if(h > hi) hi = h; if(l < lo) lo = l; }
   }
   return(found && hi > lo);
}

bool InTradeWindow()
{
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   return(dt.hour >= InpTradeStartHour && dt.hour < InpTradeEndHour);
}

double CalcLot(double entry, double sl)
{
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0;
   double slDist = MathAbs(entry - sl);
   if(slDist <= 0) return(0);

   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0 || tickValue <= 0) return(0);

   double lossPerLot = (slDist / tickSize) * tickValue;
   if(lossPerLot <= 0) return(0);

   double lot     = riskMoney / lossPerLot;
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   lot = MathFloor(lot / lotStep) * lotStep;
   if(lot < minLot) return(0);
   if(lot > maxLot) lot = maxLot;
   return(lot);
}

int CountMyPositions()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(PositionGetTicket(i) == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == (long)InpMagic) n++;
   }
   return(n);
}

int CountMyPending()
{
   int n = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(OrderGetTicket(i) == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == _Symbol &&
         OrderGetInteger(ORDER_MAGIC) == (long)InpMagic) n++;
   }
   return(n);
}

void DeleteAllPending()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == _Symbol &&
         OrderGetInteger(ORDER_MAGIC) == (long)InpMagic) trade.OrderDelete(ticket);
   }
   pendingPlacedAt = 0;
}

//--- OCO: khi mot ben khop thi huy ben con lai
void EnforceOCO()
{
   if(CountMyPositions() > 0 && CountMyPending() > 0) DeleteAllPending();
}

void CancelExpiredPending()
{
   if(InpPendingBars <= 0 || pendingPlacedAt == 0 || CountMyPending() == 0) return;
   int barsPassed = Bars(_Symbol, PERIOD_CURRENT, pendingPlacedAt, TimeCurrent());
   if(barsPassed >= InpPendingBars) DeleteAllPending();
}

//--- Hoa von + trailing
void ManageOpen()
{
   double atr = ATRValue();
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;

      ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double cur  = (type == POSITION_TYPE_BUY)
                    ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                    : SymbolInfoDouble(_Symbol, SYMBOL_ASK);

      double initialRisk = MathAbs(open - sl);
      if(initialRisk <= 0) continue;
      double newSl = sl;

      //--- Doi SL ve hoa von khi dat 1R
      if(InpMoveToBreakeven)
      {
         double moved = (type == POSITION_TYPE_BUY) ? (cur - open) : (open - cur);
         if(moved >= initialRisk)
         {
            if(type == POSITION_TYPE_BUY  && sl < open) newSl = open;
            if(type == POSITION_TYPE_SELL && (sl > open || sl == 0)) newSl = open;
         }
      }

      //--- Trailing theo ATR
      if(InpTrailAtr > 0 && atr > 0)
      {
         double trail = (type == POSITION_TYPE_BUY) ? (cur - atr * InpTrailAtr)
                                                    : (cur + atr * InpTrailAtr);
         if(type == POSITION_TYPE_BUY  && trail > newSl) newSl = trail;
         if(type == POSITION_TYPE_SELL && (trail < newSl || newSl == 0)) newSl = trail;
      }

      newSl = NormalizeDouble(newSl, digits);
      if(MathAbs(newSl - sl) > SymbolInfoDouble(_Symbol, SYMBOL_POINT))
         trade.PositionModify(ticket, newSl, tp);
   }
}

bool RiskGateOpen()
{
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   if(dt.day != currentDay)
   {
      currentDay = dt.day;
      dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      tradedToday = false;
   }
   if(InpOneTradePerDay && tradedToday) return(false);
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
   EnforceOCO();
   ManageOpen();

   if(!IsNewBar()) return;
   CancelExpiredPending();

   if(CountMyPositions() > 0 || CountMyPending() > 0) return;
   if(!InTradeWindow()) return;
   if(!RiskGateOpen()) return;

   double hi, lo;
   if(!GetRange(hi, lo)) return;

   double atr = ATRValue();
   if(atr <= 0) return;

   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double buyEntry  = NormalizeDouble(hi + atr * InpBufferAtr, digits);
   double sellEntry = NormalizeDouble(lo - atr * InpBufferAtr, digits);

   double buySl  = NormalizeDouble(buyEntry  - atr * InpSlAtr, digits);
   double sellSl = NormalizeDouble(sellEntry + atr * InpSlAtr, digits);
   double buyTp  = NormalizeDouble(buyEntry  + atr * InpSlAtr * InpRR, digits);
   double sellTp = NormalizeDouble(sellEntry - atr * InpSlAtr * InpRR, digits);

   //--- Gia phai dang nam TRONG bien do thi lenh stop moi hop le
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask >= buyEntry || bid <= sellEntry) return;

   double lotBuy  = CalcLot(buyEntry, buySl);
   double lotSell = CalcLot(sellEntry, sellSl);
   if(lotBuy <= 0 || lotSell <= 0) return;

   bool a = trade.BuyStop(lotBuy, buyEntry, _Symbol, buySl, buyTp, ORDER_TIME_GTC, 0, "Breakout BUY");
   bool b = trade.SellStop(lotSell, sellEntry, _Symbol, sellSl, sellTp, ORDER_TIME_GTC, 0, "Breakout SELL");

   if(a || b)
   {
      pendingPlacedAt = TimeCurrent();
      tradedToday = true;
      PrintFormat("Dat OCO: BuyStop %.5f (SL %.5f TP %.5f) | SellStop %.5f (SL %.5f TP %.5f)",
                  buyEntry, buySl, buyTp, sellEntry, sellSl, sellTp);
   }
}
//+------------------------------------------------------------------+
