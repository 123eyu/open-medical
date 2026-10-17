export function tableCitationRows(data, highlight) {
  if (!highlight) return [];
  return data.sheets.flatMap((sheet) =>
    sheet.rows
      .filter(
        (row) =>
          row.startLine &&
          row.startLine <= highlight.endLine &&
          row.endLine >= highlight.startLine,
      )
      .map((row) => ({ sheet: sheet.name, ...row })),
  );
}

export function tableCitationLabel(rows) {
  return [...new Set(rows.map((row) => row.sheet))]
    .map((sheet) => {
      const numbers = rows
        .filter((row) => row.sheet === sheet)
        .map((row) => row.row);
      return `${sheet} · 第 ${numbers.join("、")} 行`;
    })
    .join("；");
}
