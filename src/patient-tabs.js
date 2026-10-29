// The communication area is shared by plugin tabs (messages/followups) and
// fixed tabs (appointments/tracking). A caller can request a plugin tab while
// the plugin is disabled; always land on the first tab that still exists.
export function resolveCommunicationTab(tabs, requested) {
  if (!["messages", "followups", "tracking"].includes(requested))
    return requested;
  if (tabs.some((tab) => tab.key === requested)) return requested;
  return tabs[0]?.key || "appointments";
}
