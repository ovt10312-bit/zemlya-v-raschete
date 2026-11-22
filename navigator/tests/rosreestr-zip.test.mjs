import {test} from 'node:test';import assert from 'node:assert/strict';import {deflateRawSync} from 'node:zlib';
import {zipCSVPrefix} from '../server/rosreestr-zip.mjs';
import {csvPreview} from '../server/rosreestr-source.mjs';
function zipEntry(content,{method=8,descriptor=false,name='dataset_СДЕЛКИ.csv',encrypted=false}={}){
 const data=Buffer.from(content),compressed=method===8?deflateRawSync(data):data,filename=Buffer.from(name),header=Buffer.alloc(30);
 header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800|(descriptor?8:0)|(encrypted?1:0),6);header.writeUInt16LE(method,8);if(!descriptor){header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22)}header.writeUInt16LE(filename.length,26);
 return Buffer.concat([header,filename,compressed]);
}
const csv='Кадастровый квартал;Площадь;Цена\r\n40:04:010802;800;600000\r\n';
test('stored and deflated CSV entries preview without extracting files or declaring full archive integrity',async()=>{
 for(const method of [0,8]){const result=await zipCSVPrefix(zipEntry(csv,{method}));assert.deepEqual(csvPreview(result.bytes).rows,[['40:04:010802','800','600000']]);assert.equal(result.archive.integrity,'not_verified_full_archive');assert.equal(result.archive.prefixOnly,true);assert.equal(result.archive.entryName,'dataset_СДЕЛКИ.csv');}
});
test('descriptor sizes need not be known to preview a deflated first CSV entry',async()=>{
 const r=await zipCSVPrefix(zipEntry(csv,{descriptor:true}));assert.equal(csvPreview(r.bytes).rows.length,1);
});
test('a compressed expansion much larger than the prefix stops at 64KiB output',async()=>{
 const archive=zipEntry(csv.repeat(500000));const r=await zipCSVPrefix(archive.subarray(0,65536));assert.equal(r.bytes.length,65536);assert.ok(r.archive.downloadedPrefixBytes<=65536);assert.equal(csvPreview(r.bytes).rows.length,8);
});
test('a truncated compressed country file still yields complete preview rows without needing its tail',async()=>{
 let text=csv;let state=104729;for(let i=0;i<40000;i++){state=(state*48271)%2147483647;text+=`40:04:010802;${state};${i}\r\n`}
 const archive=zipEntry(text);assert.ok(archive.length>65536);const r=await zipCSVPrefix(archive.subarray(0,65536));assert.equal(r.bytes.length,65536);assert.equal(csvPreview(r.bytes).rows.length,8);
});
test('known small metadata files before the CSV are skipped, unknown descriptor offsets are never guessed',async()=>{
 const archive=Buffer.concat([zipEntry('Описание',{name:'readme.txt',method:0}),zipEntry(csv)]);assert.equal(csvPreview((await zipCSVPrefix(archive)).bytes).rows.length,1);
 await assert.rejects(zipCSVPrefix(Buffer.concat([zipEntry('x',{name:'readme.txt',descriptor:true}),zipEntry(csv)])),/граница/);
});
test('HTML, encrypted entries, unsupported methods, malformed headers and oversized input stay explicit failures',async()=>{
 await assert.rejects(zipCSVPrefix(Buffer.from('<html>Access denied</html>')),/CSV не найден/);
 await assert.rejects(zipCSVPrefix(zipEntry(csv,{encrypted:true})),/Зашифрован/);
 await assert.rejects(zipCSVPrefix(zipEntry(csv,{method:12})),/Метод сжатия/);
 const header=zipEntry(csv);header.writeUInt16LE(65535,26);await assert.rejects(zipCSVPrefix(header),/заголовка/);
 await assert.rejects(zipCSVPrefix(Buffer.alloc(65537)),/лимит/);
});
