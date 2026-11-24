const ARGENTINA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba',
  year: 'numeric', month: '2-digit', day: '2-digit' });

export async function nextBusinessDay(now = new Date(), fetcher = fetch) {
  const date = new Date(`${ARGENTINA.format(now)}T12:00:00Z`);
  const holidays = new Map();
  try {
    for (let day = 0; day < 14; day++) {
      date.setUTCDate(date.getUTCDate() + 1);
      if ([0, 6].includes(date.getUTCDay())) continue;
      const year = date.getUTCFullYear();
      if (!holidays.has(year)) {
        const response = await fetcher(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`, {
          signal: AbortSignal.timeout(2200), headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error('Calendario remoto no disponible');
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length === 0 || rows.some(
          row => !row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
        )) throw new Error('Respuesta de calendario inválida');
        holidays.set(year, new Set(rows.filter(row => row.global !== false).map(row => row.date)));
      }
      const iso = date.toISOString().slice(0, 10);
      if (!holidays.get(year).has(iso)) return { date: iso, source: 'Nager.Date' };
    }
  } catch {
    // The date is advisory and never changes the pass or its stock.
  }
  return { date: null, source: null };
}
