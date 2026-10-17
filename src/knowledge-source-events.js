export const KNOWLEDGE_SOURCE_EVENT = "knowledge-source-open";

export function openKnowledgeSource(detail) {
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_SOURCE_EVENT, { detail }));
}

export function openKnowledgeCitation(href) {
  const url = new URL(href, window.location.origin);
  const params = url.searchParams;
  openKnowledgeSource({
    id: params.get("knowledgeDoc"),
    highlight: {
      startLine: Number(params.get("line")),
      endLine: Number(params.get("endLine")),
    },
    sourceHash: params.get("sourceHash"),
  });
}
