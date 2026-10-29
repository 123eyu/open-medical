import { FollowupsView } from "./FollowupsView.jsx";

// Keeps the old route adapters: settings jumps to settingsTab=followup and a
// patient link opens the followups tab.
export default function LegacyFollowupsView({ onOpenPatient, onSettings, ...props }) {
  return <FollowupsView
    {...props}
    onOpenPatient={id => onOpenPatient?.({ id, tab: "followups" })}
    onSettings={() => {
      onSettings?.();
      window.history.replaceState({}, "", "?view=settings&settingsTab=followup");
    }}
  />;
}
