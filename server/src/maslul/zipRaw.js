/**
 * maslul/zipRaw.js — קורא/כותב ZIP ברמת הבייטים, בלי ספריות חיצוניות.
 *
 * למה לא ספריית xlsx/zip רגילה: כתיבה מחדש של ה-package שוברת את הקישורים
 * ל-comments/drawings, ומסלול נכשל בייבוא עם
 *   "Cannot read properties of undefined (reading 'comments')".
 * לכן חייבים שליטה מלאה על סדר ה-entries ועל שיטת הדחיסה לכל entry —
 * מה שספריות נוחות לא נותנות. ר' מפרט §7.3.
 *
 * תומך ב-STORE (0) ו-DEFLATE (8) בלבד — התבנית משתמשת ב-DEFLATE בכל ה-entries.
 * ללא תמיכת ZIP64 (התבנית ~240KB, רחוק מהגבול).
 */
const zlib = require('zlib');

const SIG_LFH = 0x04034b50;   // Local File Header
const SIG_CDH = 0x02014b50;   // Central Directory Header
const SIG_EOCD = 0x06054b50;  // End Of Central Directory

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557); // 64KB comment max + 22
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('ZIP לא תקין: EOCD לא נמצא');
}

/** קריאת רשימת ה-entries מה-Central Directory, בסדר המקורי. */
function readEntries(buf) {
  const eocd = findEOCD(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== SIG_CDH) throw new Error('ZIP לא תקין: CDH פגום');
    const e = {
      versionMadeBy: buf.readUInt16LE(off + 4),
      versionNeeded: buf.readUInt16LE(off + 6),
      flags: buf.readUInt16LE(off + 8),
      method: buf.readUInt16LE(off + 10),
      modTime: buf.readUInt16LE(off + 12),
      modDate: buf.readUInt16LE(off + 14),
      crc32: buf.readUInt32LE(off + 16),
      csize: buf.readUInt32LE(off + 20),
      usize: buf.readUInt32LE(off + 24),
      internalAttrs: buf.readUInt16LE(off + 36),
      externalAttrs: buf.readUInt32LE(off + 38),
      localHeaderOffset: buf.readUInt32LE(off + 42),
    };
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    e.name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    e.extra = Buffer.from(buf.slice(off + 46 + nameLen, off + 46 + nameLen + extraLen));
    e.comment = Buffer.from(buf.slice(off + 46 + nameLen + extraLen, off + 46 + nameLen + extraLen + commentLen));
    entries.push(e);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** התוכן המפוענח של entry בודד. */
function readData(buf, entry) {
  const lho = entry.localHeaderOffset;
  if (buf.readUInt32LE(lho) !== SIG_LFH) throw new Error(`ZIP לא תקין: LFH פגום עבור ${entry.name}`);
  const nameLen = buf.readUInt16LE(lho + 26);
  const extraLen = buf.readUInt16LE(lho + 28);
  const start = lho + 30 + nameLen + extraLen;
  const raw = buf.slice(start, start + entry.csize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`שיטת דחיסה לא נתמכת (${entry.method}) עבור ${entry.name}`);
}

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * כתיבת ZIP חדש מרשימת entries — משמר סדר, שיטת דחיסה, חותמות זמן ותכונות
 * מה-entry המקורי. `replace` = מפה של שם-קובץ -> Buffer חדש.
 */
function writeZip(srcBuf, entries, replace = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const isReplaced = Object.prototype.hasOwnProperty.call(replace, e.name);
    const data = isReplaced ? replace[e.name] : readData(srcBuf, e);
    const method = e.method;
    const body = method === 8
      ? zlib.deflateRawSync(data, { level: 9 })
      : data;
    const crc = isReplaced ? crc32(data) : e.crc32;

    const nameBuf = Buffer.from(e.name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(SIG_LFH, 0);
    lfh.writeUInt16LE(e.versionNeeded, 4);
    lfh.writeUInt16LE(e.flags, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(e.modTime, 10);
    lfh.writeUInt16LE(e.modDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(body.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra מושמט ב-LFH (מותר; ה-CD הוא המקור הקובע)
    chunks.push(lfh, nameBuf, body);

    central.push({ e, crc, csize: body.length, usize: data.length, method, offset, nameBuf });
    offset += lfh.length + nameBuf.length + body.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(SIG_CDH, 0);
    cdh.writeUInt16LE(c.e.versionMadeBy, 4);
    cdh.writeUInt16LE(c.e.versionNeeded, 6);
    cdh.writeUInt16LE(c.e.flags, 8);
    cdh.writeUInt16LE(c.method, 10);
    cdh.writeUInt16LE(c.e.modTime, 12);
    cdh.writeUInt16LE(c.e.modDate, 14);
    cdh.writeUInt32LE(c.crc, 16);
    cdh.writeUInt32LE(c.csize, 20);
    cdh.writeUInt32LE(c.usize, 24);
    cdh.writeUInt16LE(c.nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(c.e.internalAttrs, 36);
    cdh.writeUInt32LE(c.e.externalAttrs, 38);
    cdh.writeUInt32LE(c.offset, 42);
    chunks.push(cdh, c.nameBuf);
    offset += cdh.length + c.nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

module.exports = { readEntries, readData, writeZip, crc32 };
