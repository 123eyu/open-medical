import { FollowupsView } from "./FollowupsView.jsx";
import { InactiveFollowup } from "./InactiveFollowup.jsx";
import { usePluginActive } from "../../../src/plugin-slots.jsx";

// Keeps the old route adapters: settings jumps to settingsTab=followup and a
// patient link opens the followups tab.
export default function LegacyFollowupsView({ onOpenPatient, onSettings, ...props }) {
  const active = usePluginActive("followup");
  if (!active) return <InactiveFollowup onSettings={onSettings} />;
  return <FollowupsView
    {...props}
    onOpenPatient={id => onOpenPatient?.({ id, tab: "followups" })}
    onSettings={() => {
      onSettings?.();
      window.history.replaceState({}, "", "?view=settings&settingsTab=followup");
    }}
  />;
}
