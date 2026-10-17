// Unsent project text and attachments stay in this page's memory. They may
// contain clinical material, so never write them to browser storage.
const drafts = new Map();

export function getWorkspaceDraft(id) {
  return drafts.get(id);
}

export function setWorkspaceDraft(id, draft) {
  if (!id) return;
  if (draft.prompt.trim() || draft.attachments.length) drafts.set(id, draft);
  else drafts.delete(id);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', event => {
    if (!drafts.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
