import { createHash } from "node:crypto";
import { check } from "../errors.mjs";
import { knowledgeChunks, CHUNK_VERSION } from "./knowledge-content.mjs";

export function indexError(error) {
  const code = error.code || "INDEX_WRITE_FAILED";
  const messages = {
    EMBEDDING_UNAVAILABLE:
      "无法连接嵌入服务或请求超时，请检查服务是否启动、模型是否安装。",
    EMBEDDING_MODEL_MISSING: "Ollama 模型或嵌入接口不存在，请检查是否已安装所配置的模型及服务地址。",
    EMBEDDING_AUTH: "嵌入服务认证失败，请检查访问凭据和模型权限。",
    EMBEDDING_RATE_LIMIT: "嵌入服务限流，请稍后继续，已完成批次会保留。",
    EMBEDDING_SERVICE:
      "嵌入服务拒绝请求或返回了无效向量，请检查模型、访问凭据和输入限制。",
    EMBEDDING_CONFIG: "嵌入连接配置无效，请检查地址、协议和访问凭据。",
    INDEX_WRITE_FAILED:
      "向量写入失败，请检查向量库、磁盘空间及模型维度；已生成批次可继续使用。",
    INDEX_INTERRUPTED: "索引任务因应用退出中断，可继续未完成批次。",
  };
  return {
    code,
    message: messages[code] || messages.INDEX_WRITE_FAILED,
    retryable: code !== "EMBEDDING_CONFIG",
  };
}

export function saveChunks(
  library,
  doc,
  chunks = knowledgeChunks(doc.text, doc),
) {
  const db = library.store.db;
  db.prepare("DELETE FROM guideline_chunks WHERE doc_id=?").run(doc.id);
  const insert = db.prepare(
    "INSERT INTO guideline_chunks(doc_id,ord,start_line,end_line,text,metadata) VALUES(?,?,?,?,?,?)",
  );
  for (const chunk of chunks)
    insert.run(
      doc.id,
      chunk.ord,
      chunk.startLine,
      chunk.endLine,
      chunk.text,
      JSON.stringify(chunk.metadata),
    );
  return chunks;
}

export async function indexKnowledgeDoc(library, id) {
  if (library.indexTasks.has(id)) return library.indexTasks.get(id);
  check(!library.deletingCollection, "KNOWLEDGE_BUSY", "知识库正在删除", 409);
  const initialDoc = library.docRow(id);
  const task = (async () => {
    library.activeIndexWrites++;
    const doc = initialDoc,
      chunks = knowledgeChunks(doc.text, doc);
    const model = library.embedder?.model || null;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          CHUNK_VERSION,
          doc.text,
          model,
          library.embedder?.config?.url,
          library.embedder?.config?.provider,
          chunks.map((c) => c.embeddingText),
        ]),
      )
      .digest("hex");
    const write = (patch) => {
      const current = library.docRow(id);
      current.indexing = {
        ...current.indexing,
        ...patch,
        model,
        total: chunks.length,
        updatedAt: new Date().toISOString(),
      };
      library.store.db
        .prepare("UPDATE guideline_docs SET data=? WHERE id=?")
        .run(JSON.stringify(current), id);
      return current.indexing;
    };
    try {
      // Old chunk layouts are replaced together with their SQLite metadata.
      library.store.db.exec("BEGIN IMMEDIATE");
      try {
        saveChunks(library, doc, chunks);
        library.store.db.exec("COMMIT");
      } catch (e) {
        library.store.db.exec("ROLLBACK");
        throw e;
      }
      if (!library.embedder?.available() || !library.vectorStore)
        return write({
          status: "keyword_only",
          embedded: 0,
          processed: 0,
          error: null,
        });
      const db = library.store.db;
      db.prepare(
        "DELETE FROM knowledge_embedding_batches WHERE doc_id=? AND fingerprint<>?",
      ).run(id, fingerprint);
      const cached = new Map(
        db
          .prepare(
            "SELECT ord,vector FROM knowledge_embedding_batches WHERE doc_id=? AND fingerprint=?",
          )
          .all(id, fingerprint)
          .map((r) => [r.ord, JSON.parse(r.vector)]),
      );
      write({
        status: "running",
        embedded: 0,
        processed: cached.size,
        error: null,
        fingerprint,
      });
      const pending = chunks.filter((c) => !cached.has(c.ord));
      for (let at = 0; at < pending.length; at += 16) {
        const batch = pending.slice(at, at + 16);
        const vectors = await library.embedder.embed(
          batch.map((c) => c.embeddingText),
        );
        check(
          Array.isArray(vectors) &&
            vectors.length === batch.length &&
            vectors.every(
              (v) =>
                Array.isArray(v) && v.length >= 2 && v.every(Number.isFinite),
            ),
          "EMBEDDING_SERVICE",
          "嵌入批次不完整",
        );
        const insert = db.prepare(
          "INSERT OR REPLACE INTO knowledge_embedding_batches VALUES(?,?,?,?)",
        );
        db.exec("BEGIN IMMEDIATE");
        try {
          batch.forEach((c, i) => {
            insert.run(id, fingerprint, c.ord, JSON.stringify(vectors[i]));
            cached.set(c.ord, vectors[i]);
          });
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        write({ processed: cached.size });
      }
      await library.vectorStore.upsertDoc(
        id,
        model,
        chunks.map((c) => ({
          doc_id: id,
          ord: c.ord,
          title: doc.title,
          org: doc.org,
          year: doc.year,
          start_line: c.startLine,
          end_line: c.endLine,
          text: c.text,
          vector: cached.get(c.ord),
        })),
      );
      return write({
        status: "ready",
        embedded: chunks.length,
        processed: chunks.length,
        error: null,
        fingerprint,
      });
    } catch (error) {
      return write({ status: "failed", embedded: 0, error: indexError(error) });
    } finally {
      library.activeIndexWrites--;
    }
  })();
  library.indexTasks.set(id, task);
  try {
    return await task;
  } finally {
    library.indexTasks.delete(id);
  }
}
