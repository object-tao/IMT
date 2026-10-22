// Local clock conversion uses IANA zones, including daylight saving offsets.
export function localParts(epoch: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(epoch);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}
export function zoneDate(epoch: number, zone: string) { const p = localParts(epoch, zone); return `${p.year}-${p.month}-${p.day}`; }
export function localToEpoch(date: string, clock: string, zone: string): number | undefined {
  const target = Date.parse(`${date}T${clock}:00Z`);
  let guess = target;
  for (let i = 0; i < 5; i++) {
    const p = localParts(guess, zone);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const delta = target - represented;
    if (!delta) return guess;
    guess += delta;
  }
  return undefined; // nonexistent local clock at a DST transition
}
export function nextDeparture(earliest: number, schedule: { weekdays: number[]; departureTime: string; timeZone: string; cutoffHours: number }, validFrom: string, validTo: string) {
  const firstDate = zoneDate(earliest + schedule.cutoffHours * 3600000, schedule.timeZone);
  const start = Math.max(Date.parse(`${firstDate}T00:00:00Z`), Date.parse(`${validFrom}T00:00:00Z`));
  for (let day = 0; day < 15; day++) {
    const localDay = new Date(start + day * 86400000);
    const date = localDay.toISOString().slice(0, 10);
    if (date > validTo) return undefined;
    if (!schedule.weekdays.includes(localDay.getUTCDay())) continue;
    const departure = localToEpoch(date, schedule.departureTime, schedule.timeZone);
    if (departure !== undefined && departure - schedule.cutoffHours * 3600000 >= earliest) return departure;
  }
  return undefined;
}
