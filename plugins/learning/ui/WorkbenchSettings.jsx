import { ExtensionCenter } from "../../../src/extension-center";

// The workbench UI is the learning plugin's settings surface. The fixed skill
// center is still used for the skills tab, so this reuses the same component
// with the workbench view instead of duplicating markup and CSS.
export default function WorkbenchSettings({ onAsk }) {
  return <ExtensionCenter view="workbench" onAsk={onAsk} />;
}
