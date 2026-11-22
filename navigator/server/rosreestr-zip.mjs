import {createInflateRaw,constants} from 'node:zlib';

const LIMIT=65536;
// Preview local ZIP entries only. Nothing is extracted to disk and CRC/full archive
// validation is intentionally deferred until a full import is implemented.
export async function zipCSVPrefix(input){
 const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
 if(bytes.length>LIMIT)throw Error('Превышен лимит образца ZIP.');
 let offset=0;
 for(let entries=0;entries<16;entries++){
  if(offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)throw Error('CSV не найден в начальном фрагменте ZIP. Полный архив не загружался.');
  const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),compressedSize=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28),start=offset+30+nameLength+extraLength;
  if(start>bytes.length)throw Error('Начальный фрагмент ZIP не содержит полного заголовка файла.');
  if(flags&1)throw Error('Зашифрованный ZIP не поддерживается.');
  const rawName=bytes.subarray(offset+30,offset+30+nameLength),name=new TextDecoder(flags&0x800?'utf-8':'windows-1251').decode(rawName);
  if(/\.csv$/i.test(name)){
   const sizeKnown=!(flags&8)||compressedSize>0;
   const end=sizeKnown&&compressedSize!==0xffffffff?Math.min(bytes.length,start+compressedSize):bytes.length;
   const payload=bytes.subarray(start,end);let result;
   if(method===0)result=payload.subarray(0,LIMIT);
   else if(method===8)result=await inflatePrefix(payload);
   else throw Error(`Метод сжатия ZIP ${method} пока не поддерживается.`);
   return {bytes:result,archive:{entryName:name.slice(0,300),method,downloadedPrefixBytes:bytes.length,uncompressedPrefixBytes:result.length,integrity:'not_verified_full_archive',prefixOnly:true}};
  }
  // Never scan signatures inside compressed data or guess sizes from descriptors.
  if(flags&8||compressedSize===0xffffffff||start+compressedSize>bytes.length)throw Error('Перед CSV находится другой файл; его граница вне образца ZIP. Полный архив не загружался.');
  offset=start+compressedSize;
 }
 throw Error('Слишком много файлов перед CSV в образце ZIP.');
}
function inflatePrefix(payload){
 return new Promise((resolve,reject)=>{
  const inflater=createInflateRaw({finishFlush:constants.Z_SYNC_FLUSH,chunkSize:16384});const chunks=[];let size=0,settled=false;
  function done(error){if(settled)return;settled=true;inflater.destroy();if(error)reject(Error('Не удалось прочитать сжатый CSV: '+error.message));else resolve(Buffer.concat(chunks,size));}
  inflater.on('data',chunk=>{const part=chunk.subarray(0,Math.max(0,LIMIT-size));chunks.push(part);size+=part.length;if(size>=LIMIT)done()});
  inflater.on('end',()=>done());inflater.on('error',error=>done(error));inflater.end(payload);
 });
}
