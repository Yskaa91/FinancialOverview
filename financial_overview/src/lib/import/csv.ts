// ASN is the only source without a header, and the only one whose narrative may
// hold the delimiter and a newline. It quotes with ' in the comma variant and
// with " in the semicolon variant, so the tokenizer honours both.

export type CsvRecord = {
  /** 1-based line of the physical file where the record starts. */
  line: number;
  fields: string[];
};

/** Splits on newlines only outside quotes; blank records are dropped. */
export function parseCsv(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quote: string | null = null;
  let line = 1;
  let recordLine = 1;
  let touched = false;

  const endRecord = () => {
    fields.push(field);
    field = "";
    if (touched) records.push({ line: recordLine, fields });
    fields = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quote) {
      if (char === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else {
          quote = null;
        }
      } else {
        if (char === "\n") line++;
        field += char;
      }
      touched = true;
      continue;
    }

    // A quote only opens a quoted field at the start of that field, so an
    // apostrophe inside a name stays a character.
    if (field === "" && (char === '"' || char === "'")) {
      quote = char;
      touched = true;
      continue;
    }
    if (char === delimiter) {
      fields.push(field);
      field = "";
      touched = true;
      continue;
    }
    if (char === "\n") {
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    if (char === "\r") continue;

    field += char;
    touched = true;
  }

  if (touched || field !== "") {
    fields.push(field);
    field = "";
    records.push({ line: recordLine, fields });
  }

  return records;
}

/**
 * Picks the delimiter that makes the file look most like a table: the modal
 * field count decides, and `expectedFields` settles a tie in favour of the
 * shape the format documents.
 */
export function sniffDelimiter(text: string, candidates: string[], expectedFields?: number): string {
  let best = candidates[0];
  let bestScore = -1;

  for (const delimiter of candidates) {
    const counts = new Map<number, number>();
    for (const record of parseCsv(text, delimiter).slice(0, 200)) {
      counts.set(record.fields.length, (counts.get(record.fields.length) ?? 0) + 1);
    }
    const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    const score = modal[0] * 1000 + modal[1] + (modal[0] === expectedFields ? 1_000_000 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

/** Cell by column index that may not exist in an older or shorter row. */
export function cell(fields: string[], at: number | undefined): string {
  return at === undefined ? "" : (fields[at] ?? "");
}
