import { inflateRawSync } from 'zlib';
import { buildXlsx } from './xlsx';

/** Minimal ZIP reader to prove the archive is structurally valid (names, CRCs, inflate round-trip). */
function readZip(buf: Buffer) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString();
    const lnlen = buf.readUInt16LE(lho + 26);
    const data = buf.slice(lho + 30 + lnlen, lho + 30 + lnlen + csize);
    out[name] = inflateRawSync(data).toString('utf8');
    p += 46 + nlen;
  }
  return out;
}

describe('xlsx writer', () => {
  it('creates a valid workbook with several sheets, typed cells and safe text', () => {
    const buf = buildXlsx([
      { name: 'Daily 2026-10-05', title: 'Attendance', columns: [{ header: 'Name', width: 20 }, { header: 'In' }, { header: 'Hours' }], rows: [['Asha <&> "Rao"', new Date('2026-10-05T04:00:00Z'), { v: 7.5, style: 'hours' }], ['=HYPERLINK("x")', null, 8]] },
      { name: 'Bad/Name:*?[]', columns: [{ header: 'A' }], rows: [] },
    ]);
    const files = readZip(buf);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
    expect(files['xl/workbook.xml']).toContain('name="Daily 2026-10-05"');
    expect(files['xl/workbook.xml']).not.toMatch(/name="[^"]*[\[\]:*?\/\\]/); // illegal sheet-name chars removed
    const s1 = files['xl/worksheets/sheet1.xml'];
    expect(s1).toContain('Asha &lt;&amp;&gt; &quot;Rao&quot;');
    expect(s1).toContain('<v>7.5</v>');
    expect(s1).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK'); // stored as text, never a formula
    expect(s1).not.toContain('<f>');
    expect(s1).toContain('<autoFilter');
    for (const [name, xml] of Object.entries(files)) expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('strips control characters that would corrupt the XML', () => {
    const files = readZip(buildXlsx([{ name: 'S', columns: [{ header: 'H' }], rows: [['a\u0001b\u0008c']] }]));
    expect(files['xl/worksheets/sheet1.xml']).toContain('abc');
  });

  it('keeps sheet names unique and at most 31 characters', () => {
    const long = 'x'.repeat(50);
    const files = readZip(buildXlsx([{ name: long, columns: [], rows: [] }, { name: long, columns: [], rows: [] }]));
    const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });
});
