import { CareInbox } from "./CareInbox.jsx";
import { InactiveFollowup } from "./InactiveFollowup.jsx";
import { usePluginConnected } from "../../../src/plugin-slots.jsx";

// The historical view=care route opened patients on the messages tab.
export default function LegacyCareInbox({ onOpenPatient, onSettings, ...props }) {
  // Patient messages need a connected WeChat/WeCom channel.
  const connected = usePluginConnected("followup");
  if (!connected) return <InactiveFollowup onSettings={onSettings} />;
  return <CareInbox {...props} onOpenPatient={id => onOpenPatient?.({ id, tab: "messages" })} />;
}
