// A small dependency-free OOXML writer. Produces a real ZIP-based .xlsx workbook.
// Uses inline strings (no shared string table), numeric cells, dates as ISO text.
import { deflateRawSync } from "node:zlib";
import { cents, rupees } from "../utils/validation.js";
const xml = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const col = n => { let s=""; for (let x=n+1; x; x=Math.floor((x-1)/26)) s=String.fromCharCode(65+(x-1)%26)+s; return s; };
function crc32(data) { let c=-1; for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xEDB88320:0);}return (c^-1)>>>0; }
function packZip(files) {
  const chunks=[], central=[]; let offset=0;
  files.forEach(([name, content])=>{
    const data=Buffer.from(content), compressed=deflateRawSync(data), filename=Buffer.from(name), crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0,6);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    chunks.push(header,filename,compressed);
    const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(8,10);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(compressed.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(filename.length,28);dir.writeUInt32LE(offset,42);central.push(dir,filename);
    offset+=header.length+filename.length+compressed.length;
  });
  const size=central.reduce((total,b)=>total+b.length,0), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...central,end]);
}
export function workbook({ title, studentName, studentCode, headings, rows, widths = [] }) {
  const all = [[title],[`Student: ${studentName}`],[`Student code: ${studentCode}`],[],headings,...rows];
  const cell=(value,r,c)=>{
    if(value===null || value===undefined)return "";
    const ref=`${col(c)}${r}`;
    const style=r<=3?1:r===5?2:0;
    if(typeof value==="number" && Number.isFinite(value)) return `<c r="${ref}" s="3"><v>${value}</v></c>`;
    const str=String(value);
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(str)}</t></is></c>`;
  };
  const cols=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("");
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>${cols}</cols><sheetData>${all.map((row,i)=>`<row r="${i+1}">${row.map((val,j)=>cell(val,i+1,j)).join("")}</row>`).join("")}</sheetData><autoFilter ref="A5:${col(headings.length-1)}${Math.max(5,all.length)}"/></worksheet>`;
  const types=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const book=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Payments" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const bookRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF172554"/></font><font><b/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return packZip([["[Content_Types].xml",types],["_rels/.rels",rels],["xl/workbook.xml",book],["xl/_rels/workbook.xml.rels",bookRels],["xl/worksheets/sheet1.xml",sheet],["xl/styles.xml",styles]]);
}
export const amountNumber = value => Number(rupees(cents(value)));
