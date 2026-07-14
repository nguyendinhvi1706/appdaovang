export type Direction = 'BUY' | 'SELL';
export type TradeResult = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';

export interface Quote {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  currency: string;
  time: string | null;
}

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}
