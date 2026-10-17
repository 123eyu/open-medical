import { useEffect, useMemo, useRef, useState } from "react";
import {
  tableCitationRows,
  tableCitationLabel,
} from "./knowledge-table-model.mjs";

export function KnowledgeTablePreview({
  data,
  highlight,
  addresses = false,
  showCitationLabel = true,
}) {
  const cited = useMemo(
    () => tableCitationRows(data, highlight),
    [data, highlight],
  );
  const [sheet, setSheet] = useState(cited[0]?.sheet || data.sheets[0].name);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const root = useRef(null);
  const chooseCitation = () => {
    if (!cited.length) return;
    const target = cited[0],
      rows = data.sheets
        .find((s) => s.name === target.sheet)
        .rows.filter((r) => r.row !== r.headerRow);
    setSheet(target.sheet);
    setQuery("");
    setPage(
      Math.max(0, Math.floor(rows.findIndex((r) => r.row === target.row) / 50)),
    );
  };
  useEffect(chooseCitation, [data, highlight?.startLine, highlight?.endLine]);
  useEffect(() => {
    const target = root.current?.querySelector(".kw-cited-row");
    if (!target) return;
    const container = root.current.closest(".kw-source-body");
    if (container) {
      const rect = target.getBoundingClientRect(),
        parent = container.getBoundingClientRect();
      if (rect.bottom > parent.bottom || rect.top < parent.top)
        container.scrollTop += rect.top - parent.top - 120;
    }
  }, [sheet, page, highlight?.startLine, highlight?.endLine]);
  const allRows = data.sheets.find((s) => s.name === sheet)?.rows || [];
  const rows = allRows.filter((r) => r.row !== r.headerRow);
  const filtered = rows.filter(
    (r) =>
      !query ||
      r.values.some((v) => v.value.toLowerCase().includes(query.toLowerCase())),
  );
  const visible = filtered.slice(page * 50, (page + 1) * 50);
  const columns = [
    ...new Set(allRows.flatMap((r) => r.values.map((v) => v.column))),
  ].sort((a, b) => a - b);
  const headers = new Map(
    allRows.flatMap((r) =>
      r.values.filter((v) => v.header).map((v) => [v.column, v.header]),
    ),
  );
  const isCited = (row) =>
    cited.some((c) => c.sheet === sheet && c.row === row.row);
  const shown =
    visible.some(isCited) ||
    allRows.some((r) => r.row === r.headerRow && isCited(r));
  return (
    <section
      ref={root}
      className="kw-sheet kw-sheet-primary"
      aria-label="表格原文"
    >
      {highlight &&
        (cited.length ? (
          (showCitationLabel || !shown) && (
            <div className="kw-table-citation" role="status">
              <strong>本次引用：{tableCitationLabel(cited)}</strong>
              {!shown && (
                <>
                  <span>当前浏览的工作表、筛选或分页未显示引用行。</span>
                  <button className="text-button" onClick={chooseCitation}>
                    回到引用行
                  </button>
                </>
              )}
            </div>
          )
        ) : (
          <p className="form-error" role="alert">
            无法将此引用与当前表格对应，请在“更多”中核对提取文本或原件。
          </p>
        ))}
      <div className="kw-filters">
        <label>
          工作表
          <select
            aria-label="预览工作表"
            value={sheet}
            onChange={(e) => {
              setSheet(e.target.value);
              setQuery("");
              setPage(0);
            }}
          >
            {data.sheets.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          查找行
          <input
            aria-label="查找表格行"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="筛选单元格内容"
          />
        </label>
      </div>
      <div
        className="kw-table-scroll"
        role="region"
        aria-label={`${sheet}表格，可横向滚动`}
        tabIndex={0}
      >
        <table className="kw-table">
          <thead>
            <tr
              className={
                allRows.some((r) => r.row === r.headerRow && isCited(r))
                  ? "kw-cited-row"
                  : ""
              }
            >
              <th scope="col">原始行</th>
              {columns.map((c) => (
                <th scope="col" key={c}>
                  {headers.get(c) || `列 ${c}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.row}
                data-row={r.row}
                aria-selected={isCited(r) || undefined}
                className={isCited(r) ? "kw-cited-row" : ""}
              >
                <th scope="row">
                  {r.row}
                  {isCited(r) && <small>引用</small>}
                  {r.hidden && <small>原表隐藏</small>}
                </th>
                {columns.map((c) => {
                  const v = r.values.find((v) => v.column === c);
                  return (
                    <td key={c}>
                      {v ? (
                        <>
                          <span>{v.value || "空白"}</span>
                          {addresses && (
                            <small>
                              {v.address}
                              {v.mergedFrom ? ` · 合并自 ${v.mergedFrom}` : ""}
                            </small>
                          )}
                        </>
                      ) : (
                        <span className="muted">空白</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p role="status">没有匹配的行，请更换筛选条件。</p>}
      {filtered.length > 50 && (
        <div className="kw-pagination">
          <button
            className="secondary"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(filtered.length / 50))}
          </span>
          <button
            className="secondary"
            disabled={(page + 1) * 50 >= filtered.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
}
