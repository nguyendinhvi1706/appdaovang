//+------------------------------------------------------------------+
//|                                      AppDaoVang_DCA_Grid.mq5      |
//|  DCA / Grid co PHANH CUNG — de kiem chung, khong phai de tin      |
//|                                                                   |
//|  CANH BAO TOAN HOC (doc truoc khi chay):                          |
//|  DCA nhan he so cho ty le thang RAT CAO va duong von rat dep,     |
//|  nhung do la doi xac suat thang lay RUI RO THAM HOA. Voi he so    |
//|  1.3 va 6 tang, tong khoi luong tang cuoi gap ~6.7 lan tang dau.  |
//|  Mot xu huong keo dai khong hoi la mat sach. Ty le thang 95% van  |
//|  co the lo neu 5% con lai xoa het lai cua 95%.                    |
//|                                                                   |
//|  EA nay BAT BUOC co cat lo toan ro. Khong co che do nhan vo han.  |
//+------------------------------------------------------------------+
#property copyright "AppDaoVang - open source"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

enum ENUM_ENTRY_MODE
{
   ENTRY_BOTH,      // Mo ca 2 chieu
   ENTRY_BUY_ONLY,  // Chi Buy
   ENTRY_SELL_ONLY  // Chi Sell
};

input group "=== Vao lenh ==="
input ENUM_ENTRY_MODE InpEntryMode   = ENTRY_BOTH;
input double InpStartLot             = 0.01;   // Lot tang dau
input double InpMultiplier           = 1.3;    // He so nhan moi tang (1.0 = khong nhan)
input int    InpMaxLevels            = 6;      // So tang toi da
input int    InpStepPoints           = 500;    // Khoang cach giua cac tang (points)
input int    InpTakeProfitPoints     = 300;    // TP tinh tu gia hoa von cua ro (points)

input group "=== PHANH CUNG (khong nen tat) ==="
input double InpBasketStopLossPct    = 10.0;   // Cat lo TOAN RO khi lo qua % von nay (0 = TAT - RAT NGUY HIEM)
input double InpDailyLossStopPct     = 5.0;    // Ngung mo ro moi trong ngay khi lo qua %
input double InpMaxSpreadPoints      = 100;    // Bo qua khi spread gian rong

input group "=== Bo loc vao lenh ==="
input int    InpRsiPeriod            = 14;
input double InpRsiBuyBelow          = 40.0;   // Chi mo ro Buy khi RSI duoi muc nay
input double InpRsiSellAbove         = 60.0;   // Chi mo ro Sell khi RSI tren muc nay

input group "=== Khac ==="
input ulong  InpMagic                = 20260806;
input int    InpSlippage             = 30;

CTrade   trade;
int      hRSI = INVALID_HANDLE;
double   dayStartBalance = 0;
int      currentDay = -1;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   hRSI = iRSI(_Symbol, PERIOD_CURRENT, InpRsiPeriod, PRICE_CLOSE);
   if(hRSI == INVALID_HANDLE) return(INIT_FAILED);

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);

   if(InpBasketStopLossPct <= 0)
      Print("CANH BAO: da TAT cat lo toan ro. Mot xu huong keo dai co the lam mat toan bo von.");

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { if(hRSI != INVALID_HANDLE) IndicatorRelease(hRSI); }

//+------------------------------------------------------------------+
double RSIValue()
{
   double buf[];
   if(CopyBuffer(hRSI, 0, 1, 1, buf) <= 0) return(50.0);
   return(buf[0]);
}

bool IsNewBar()
{
   datetime t = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(t == lastBarTime) return(false);
   lastBarTime = t;
   return(true);
}

//--- Thong tin ro lenh theo huong
void BasketInfo(ENUM_POSITION_TYPE type, int &count, double &volume, double &weightedPrice,
                double &profit, double &worstPrice)
{
   count = 0; volume = 0; weightedPrice = 0; profit = 0; worstPrice = 0;
   double volPriceSum = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;
      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) != type) continue;

      double v = PositionGetDouble(POSITION_VOLUME);
      double p = PositionGetDouble(POSITION_PRICE_OPEN);
      count++;
      volume += v;
      volPriceSum += v * p;
      profit += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);

      if(type == POSITION_TYPE_BUY)  { if(worstPrice == 0 || p < worstPrice) worstPrice = p; }
      else                           { if(worstPrice == 0 || p > worstPrice) worstPrice = p; }
   }
   if(volume > 0) weightedPrice = volPriceSum / volume;
}

void CloseBasket(ENUM_POSITION_TYPE type)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagic) continue;
      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) != type) continue;
      trade.PositionClose(ticket);
   }
}

double NormalizeLot(double lot)
{
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   lot = MathFloor(lot / lotStep) * lotStep;
   if(lot < minLot) lot = minLot;
   if(lot > maxLot) lot = maxLot;
   return(lot);
}

bool RiskGateOpen()
{
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   if(dt.day != currentDay)
   {
      currentDay = dt.day;
      dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   }
   if(InpDailyLossStopPct > 0)
   {
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      double lossPct = (dayStartBalance - equity) / dayStartBalance * 100.0;
      if(lossPct >= InpDailyLossStopPct) return(false);
   }
   double spread = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(InpMaxSpreadPoints > 0 && spread > InpMaxSpreadPoints) return(false);
   return(true);
}

//+------------------------------------------------------------------+
//| Quan ly mot ro theo huong                                         |
//+------------------------------------------------------------------+
void ManageBasket(ENUM_POSITION_TYPE type)
{
   int count; double volume, avgPrice, profit, worstPrice;
   BasketInfo(type, count, volume, avgPrice, profit, worstPrice);

   double point   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double bid     = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask     = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);

   //--- PHANH CUNG: cat lo toan ro
   if(count > 0 && InpBasketStopLossPct > 0)
   {
      double lossPct = (-profit) / balance * 100.0;
      if(lossPct >= InpBasketStopLossPct)
      {
         PrintFormat("PHANH CUNG: dong ro %s, lo %.2f%% von (%.2f)",
                     (type == POSITION_TYPE_BUY ? "BUY" : "SELL"), lossPct, profit);
         CloseBasket(type);
         return;
      }
   }

   //--- Chot lai toan ro khi dat TP tinh tu gia hoa von
   if(count > 0)
   {
      double tpPrice = (type == POSITION_TYPE_BUY)
                       ? avgPrice + InpTakeProfitPoints * point
                       : avgPrice - InpTakeProfitPoints * point;
      bool hit = (type == POSITION_TYPE_BUY) ? (bid >= tpPrice) : (ask <= tpPrice);
      if(hit)
      {
         PrintFormat("Chot ro %s: %d lenh, lai %.2f",
                     (type == POSITION_TYPE_BUY ? "BUY" : "SELL"), count, profit);
         CloseBasket(type);
         return;
      }
   }

   if(!RiskGateOpen()) return;

   //--- Mo tang dau
   if(count == 0)
   {
      if(type == POSITION_TYPE_BUY  && InpEntryMode == ENTRY_SELL_ONLY) return;
      if(type == POSITION_TYPE_SELL && InpEntryMode == ENTRY_BUY_ONLY)  return;

      double rsi = RSIValue();
      if(type == POSITION_TYPE_BUY  && rsi > InpRsiBuyBelow)  return;
      if(type == POSITION_TYPE_SELL && rsi < InpRsiSellAbove) return;

      double lot = NormalizeLot(InpStartLot);
      if(type == POSITION_TYPE_BUY) trade.Buy(lot, _Symbol, 0, 0, 0, "DCA lv1");
      else                          trade.Sell(lot, _Symbol, 0, 0, 0, "DCA lv1");
      return;
   }

   //--- Mo them tang khi gia di nguoc du xa
   if(count >= InpMaxLevels) return;

   double nextPrice = (type == POSITION_TYPE_BUY)
                      ? worstPrice - InpStepPoints * point
                      : worstPrice + InpStepPoints * point;
   bool reached = (type == POSITION_TYPE_BUY) ? (ask <= nextPrice) : (bid >= nextPrice);
   if(!reached) return;

   double lot = NormalizeLot(InpStartLot * MathPow(InpMultiplier, count));

   //--- Kiem tra ky quy truoc khi them tang (tranh Margin Call giua chung)
   double marginNeeded = 0;
   double price = (type == POSITION_TYPE_BUY) ? ask : bid;
   ENUM_ORDER_TYPE ot = (type == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcMargin(ot, _Symbol, lot, price, marginNeeded)) return;
   if(marginNeeded > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.5)
   {
      Print("Bo qua them tang: ky quy tu do khong du an toan");
      return;
   }

   string cmt = StringFormat("DCA lv%d", count + 1);
   if(type == POSITION_TYPE_BUY) trade.Buy(lot, _Symbol, 0, 0, 0, cmt);
   else                          trade.Sell(lot, _Symbol, 0, 0, 0, cmt);
}

//+------------------------------------------------------------------+
void OnTick()
{
   //--- Phanh cung va chot lai phai kiem tra moi tick, khong doi nen moi
   ManageBasket(POSITION_TYPE_BUY);
   ManageBasket(POSITION_TYPE_SELL);
}
//+------------------------------------------------------------------+
