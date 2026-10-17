// Resolve only an unambiguous filename already present in the current session.
// A stored line number alone is not a stable anchor after OCR corrections.
export function sourceFile(source, files = []) {
  const text = String(source || "").trim();
  const matches = files.filter((file) => {
    if (!file.name) return false;
    const start = text.indexOf(file.name);
    if (start < 0) return false;
    const before = text.slice(0, start),
      after = text.slice(start + file.name.length);
    return (
      (!before || /[\s/\\:：「《【(（]$/.test(before)) &&
      (!after || /^[\s:：,，;；」》】)）第#]/.test(after))
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

export function exactQuote(text, quote) {
  if (!text || !quote) return null;
  const start = text.indexOf(quote);
  if (start < 0 || text.indexOf(quote, start + quote.length) >= 0) return null;
  return {
    before: text.slice(0, start),
    quote,
    after: text.slice(start + quote.length),
  };
}
