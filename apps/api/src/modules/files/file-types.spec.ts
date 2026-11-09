import { cleanFileName, contentDisposition, decideMime, extOf, isRisky, sniffMime } from './file-types';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const pdf = Buffer.from('%PDF-1.7\n');
const zip = Buffer.from([0x50, 0x4b, 3, 4, 0, 0]);
const exe = Buffer.from('MZ\x90\x00');
const html = Buffer.from('<html><script>alert(1)</script>');

describe('file type detection', () => {
  it('recognises formats from their bytes', () => {
    expect(sniffMime(png)).toBe('image/png');
    expect(sniffMime(jpg)).toBe('image/jpeg');
    expect(sniffMime(pdf)).toBe('application/pdf');
    expect(sniffMime(zip)).toBe('application/zip');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('\0\0\0\x18ftypmp42'))).toBe('video/mp4');
    expect(sniffMime(html)).toBeNull();
  });

  it('never trusts a name that lies about its content', () => {
    expect(decideMime(exe, 'holiday-photo.jpg')).toBe('application/x-msdownload');
    expect(decideMime(html, 'photo.png')).toBe('application/octet-stream'); // fake image: not displayable
    expect(decideMime(html, 'page.html')).toBe('application/octet-stream'); // html is never served as html
    expect(decideMime(html, 'logo.svg')).toBe('application/octet-stream');
  });

  it('keeps office documents (zip inside) and ordinary text files usable', () => {
    expect(decideMime(zip, 'report.docx')).toMatch(/wordprocessingml/);
    expect(decideMime(zip, 'sheet.xlsx')).toMatch(/spreadsheetml/);
    expect(decideMime(zip, 'bundle.zip')).toBe('application/zip');
    expect(decideMime(Buffer.from('a,b\n1,2'), 'data.csv')).toBe('text/csv');
    expect(decideMime(Buffer.from('hello'), 'notes.txt')).toBe('text/plain');
    expect(decideMime(Buffer.from('anything'), 'weird.xyz')).toBe('application/octet-stream');
  });

  it('flags risky extensions without blocking them', () => {
    expect(isRisky('setup.EXE')).toBe(true);
    expect(isRisky('notes.txt')).toBe(false);
    expect(extOf('archive.tar.gz')).toBe('gz');
  });
});

describe('file names', () => {
  it('strips paths and control characters, keeps real names (including non-Latin)', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\a\\report.pdf')).toBe('report.pdf');
    expect(cleanFileName('  bad\u0000na<>me?.txt ')).toBe('badname.txt');
    expect(cleanFileName('रिपोर्ट अक्टूबर.pdf')).toBe('रिपोर्ट अक्टूबर.pdf');
    expect(cleanFileName('')).toBe('file');
    expect(cleanFileName('.htaccess')).toBe('htaccess');
  });

  it('shortens very long names but keeps the extension', () => {
    const n = cleanFileName('a'.repeat(400) + '.pdf');
    expect(n.length).toBeLessThanOrEqual(150);
    expect(n.endsWith('.pdf')).toBe(true);
  });

  it('builds a safe Content-Disposition header', () => {
    const h = contentDisposition('attachment', 'रिपोर्ट "final".pdf');
    expect(h).toContain("filename*=UTF-8''");
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split('filename="')[1].split('"')[0]).toMatch(/^[\x20-\x7e]*$/);
  });
});
