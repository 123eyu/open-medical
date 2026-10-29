import { CareInbox } from "./CareInbox.jsx";

// The historical view=care route opened patients on the messages tab.
export default function LegacyCareInbox({ onOpenPatient, ...props }) {
  return <CareInbox {...props} onOpenPatient={id => onOpenPatient?.({ id, tab: "messages" })} />;
}
