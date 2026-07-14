'use client';
import AppShell from '@/components/AppShell';
import EconomicCalendar from '@/components/EconomicCalendar';

export default function CalendarPage() {
  return (
    <AppShell>
      <h1 className="text-2xl font-bold mb-4">Lịch kinh tế</h1>
      <div className="card">
        <EconomicCalendar height={640} />
      </div>
    </AppShell>
  );
}
