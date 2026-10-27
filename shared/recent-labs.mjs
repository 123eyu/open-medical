import { isCalendarDate } from "./calendar-date.mjs";

// Keep individual observations (including same-day disagreements) intact.
export function recentLabs(labs = [], limit = 3) {
  return labs
    .map((lab, index) => ({ lab, index, date: isCalendarDate(lab.date) ? lab.date : "" }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
    .slice(0, limit)
    .map(({ lab }) => lab);
}
