import { describe, expect, it } from "vitest";
import { cell, parseCsv, sniffDelimiter } from "@/lib/import/csv";

// The tokenizer feeds every parser, and ASN is the reason it handles two quote
// styles, embedded newlines and both delimiters.
describe("parseCsv", () => {
  it("splits plain rows and drops blank lines", () => {
    const records = parseCsv("a,b\n\nc,d\n", ",");
    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps the delimiter inside double quotes", () => {
    const records = parseCsv('1,"ASN, NL",3', ",");
    expect(records[0].fields).toEqual(["1", "ASN, NL", "3"]);
  });

  it("keeps a newline inside a quoted field and counts lines", () => {
    const records = parseCsv("1,'ALBERT\nHEIJN',3\n4,'X',6", ",");
    expect(records[0].fields).toEqual(["1", "ALBERT\nHEIJN", "3"]);
    expect(records[0].line).toBe(1);
    expect(records[1].line).toBe(3);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('1,"CAFE ""PLEK""",3', ",")[0].fields[1]).toBe('CAFE "PLEK"');
    expect(parseCsv("1,'CAFE ''PLEK''',3", ",")[0].fields[1]).toBe("CAFE 'PLEK'");
  });

  it("leaves an apostrophe inside a word alone", () => {
    expect(parseCsv("1,O'Brien,3", ",")[0].fields).toEqual(["1", "O'Brien", "3"]);
  });

  it("reads a semicolon file with every field quoted", () => {
    const records = parseCsv('"a";"b;c";"d"', ";");
    expect(records[0].fields).toEqual(["a", "b;c", "d"]);
  });
});

describe("sniffDelimiter", () => {
  const com = "1,A B C,,,,,EUR,10.00,EUR,-4.00,1,1,7913,BEA,1,,'X Y Z',41,Eten";
  const semi = '"1";"A B C";"";"";"";"";"";"EUR";"10.00";"EUR";"-4.00";"1";"1";"7913";"BEA";"1";"";"X Y Z";"41";"Eten"';

  it("prefers the delimiter that yields the documented width", () => {
    expect(sniffDelimiter(`${com}\n${com}`, [",", ";"], 20)).toBe(",");
    expect(sniffDelimiter(`${semi}\n${semi}`, [",", ";"], 20)).toBe(";");
  });

  it("still finds a delimiter without an expected width", () => {
    expect(sniffDelimiter(`${com}\n${com}`, [",", ";"])).toBe(",");
  });
});

describe("cell", () => {
  it("returns an empty string for a column that is not there", () => {
    expect(cell(["a"], undefined)).toBe("");
    expect(cell(["a"], 3)).toBe("");
    expect(cell(["a", "b"], 1)).toBe("b");
  });
});
