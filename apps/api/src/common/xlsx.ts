import { deflateRawSync } from 'zlib';

/**
 * Dependency-free .xlsx writer (OOXML in a ZIP, built with Node's zlib only).
 * Produces real Excel workbooks: bold coloured header, frozen header row, auto-filter, column widths,
 * proper number/date/time cells (so Excel can sum and sort them), several sheets per file.
 */
export type Cell = string | number | boolean | Date | null | undefined | { v: string | number | null; style?: 'text' | 'date' | 'time' | 'datetime' | 'hours' | 'int' | 'good' | 'warn' | 'bad' | 'muted' };
export interface Column { header: string; width?: number }
export interface Sheet { name: string; columns: Column[]; rows: Cell[][]; title?: string }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); // fixed DOS time/date (1980-01-01)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
    // XML 1.0 forbids most control characters; strip them so one bad name cannot corrupt the whole file
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

function colName(i: number): string {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Excel serial date (days since 1899-12-30). Times are stored as local wall-clock already shifted by the caller. */
function serial(d: Date): number {
  return d.getTime() / 86_400_000 + 25569;
}

// cellXfs index map
const XF = { default: 0, header: 1, date: 2, time: 3, datetime: 4, hours: 5, int: 6, text: 7, good: 8, warn: 9, bad: 10, muted: 11, title: 12 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="hh:mm"/><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/><numFmt numFmtId="167" formatCode="0.00"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF166534"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF9A3412"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B2447"/><name val="Calibri"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B2447"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, c: Cell): string {
  if (c === null || c === undefined || c === '') return `<c r="${ref}" s="${XF.default}"/>`;
  let style: string | undefined;
  let val: any = c;
  if (typeof c === 'object' && !(c instanceof Date)) { style = c.style; val = c.v; }
  if (val === null || val === undefined || val === '') return `<c r="${ref}" s="${XF[(style as keyof typeof XF) ?? 'default'] ?? 0}"/>`;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return `<c r="${ref}" s="${XF.default}"/>`;
    const s = style === 'date' ? XF.date : style === 'time' ? XF.time : XF.datetime;
    return `<c r="${ref}" s="${s}"><v>${serial(val)}</v></c>`;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    const s = style === 'hours' ? XF.hours : style === 'int' ? XF.int : style ? (XF as any)[style] : XF.default;
    return `<c r="${ref}" s="${s ?? 0}"><v>${val}</v></c>`;
  }
  if (typeof val === 'boolean') return `<c r="${ref}" s="${XF.default}" t="b"><v>${val ? 1 : 0}</v></c>`;
  const s = (style && (XF as any)[style]) ?? XF.text;
  const str = String(val);
  // never let Excel treat user text as a formula
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`;
}

function sheetXml(sh: Sheet): string {
  const hasTitle = Boolean(sh.title);
  const headerRow = hasTitle ? 3 : 1;
  const lines: string[] = [];
  let r = 1;
  if (hasTitle) {
    lines.push(`<row r="1" ht="24" customHeight="1"><c r="A1" s="${XF.title}" t="inlineStr"><is><t>${esc(sh.title!)}</t></is></c></row>`);
    r = 3;
  }
  lines.push(`<row r="${r}" ht="30" customHeight="1">${sh.columns.map((c, i) => `<c r="${colName(i)}${r}" s="${XF.header}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`).join('')}</row>`);
  sh.rows.forEach((row, ri) => {
    const rr = r + 1 + ri;
    lines.push(`<row r="${rr}">${sh.columns.map((_, ci) => cellXml(`${colName(ci)}${rr}`, row[ci])).join('')}</row>`);
  });
  const last = r + sh.rows.length;
  const cols = sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join('');
  const lastCol = colName(Math.max(0, sh.columns.length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${lines.join('')}</sheetData>${sh.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${last}"/>` : ''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
}

function safeSheetName(n: string, used: Set<string>): string {
  let s = n.replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let i = 2;
  while (used.has(s.toLowerCase())) s = `${s.slice(0, 28)} ${i++}`;
  used.add(s.toLowerCase());
  return s;
}

export function buildXlsx(sheets: Sheet[]): Buffer {
  if (!sheets.length) throw new Error('At least one sheet is required');
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ].map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') }));
  return zip(files);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
