import { CareInbox } from "./CareInbox.jsx";
import { InactiveFollowup } from "./InactiveFollowup.jsx";
import { usePluginActive } from "../../../src/plugin-slots.jsx";

// The historical view=care route opened patients on the messages tab.
export default function LegacyCareInbox({ onOpenPatient, onSettings, ...props }) {
  const active = usePluginActive("followup");
  if (!active) return <InactiveFollowup onSettings={onSettings} />;
  return <CareInbox {...props} onOpenPatient={id => onOpenPatient?.({ id, tab: "messages" })} />;
}
