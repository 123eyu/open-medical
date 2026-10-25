// Carry extraction uncertainty into every reading view without reinterpreting dates.
export function eventDateWarnings(event) {
  return [
    event?.ambiguousDates && "同一行包含多个日期，当前按首个日期索引，请核对事件归属。",
    event?.dateValid === false && "日期需要修正",
  ].filter(Boolean);
}
