// Use UTC arithmetic on an IST calendar date to avoid host-timezone differences.
export function reportPeriod(type, now = new Date()) {
    if (!['daily','weekly'].includes(type)) throw new Error('Invalid report type');
    const today = new Date(new Date(now.getTime() + 19800000).toISOString().slice(0,10) + 'T00:00:00Z');
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() - (type === 'daily' ? 1 : today.getUTCDay() + 1));
    const start = new Date(end);
    if (type === 'weekly') start.setUTCDate(start.getUTCDate() - 6);
    const day = d => d.toISOString().slice(0,10);
    return { dateFrom:day(start), dateTo:day(end), todayIST:day(today) };
}
