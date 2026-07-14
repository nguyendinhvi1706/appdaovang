'use client';
import { useEffect, useRef } from 'react';

export default function EconomicCalendar({ height = 600 }: { height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      colorTheme: 'dark',
      isTransparent: true,
      locale: 'vi_VN',
      importanceFilter: '0,1',
      width: '100%',
      height,
    });
    ref.current.appendChild(script);
  }, [height]);

  return <div ref={ref} className="tradingview-widget-container" />;
}
