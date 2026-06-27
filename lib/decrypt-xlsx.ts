/**
 * ECMA-376 Agile Encryption 복호화 (Office 2007+, AES-CBC)
 * Node.js crypto 내장 모듈 사용
 */
import crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CFB = require("cfb") as {
  read: (buf: Buffer, opts: { type: string }) => unknown;
  find: (cfb: unknown, path: string) => { content: Uint8Array } | null;
};

function utf16le(str: string): Buffer {
  const buf = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) buf.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf;
}

function getAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  return m ? m[1] : "";
}

function findTag(xml: string, localName: string): string | null {
  // <localName ...> 또는 <ns:localName ...> 모두 매치, 자기닫힘 포함
  const re = new RegExp(`<[\\w:]*${localName}\\b[^>]*>`, "i");
  const m = xml.match(re);
  return m ? m[0] : null;
}

function normHashAlgo(algo: string): string {
  return algo.toLowerCase().replace(/-/g, "");
}

function deriveCipherKey(
  password: string,
  salt: Buffer,
  spinCount: number,
  keyBits: number,
  blockSize: number,
  hashAlgo: string
): Buffer {
  const algo = normHashAlgo(hashAlgo);
  const pwBytes = utf16le(password);

  let h = crypto.createHash(algo).update(salt).update(pwBytes).digest();
  for (let i = 0; i < spinCount; i++) {
    const ib = Buffer.alloc(4);
    ib.writeUInt32LE(i, 0);
    h = crypto.createHash(algo).update(ib).update(h).digest();
  }
  const block0 = Buffer.alloc(4, 0);
  h = crypto.createHash(algo).update(h).update(block0).digest();

  // 키를 keyBits/8 바이트로 맞춤 (부족하면 반복 채움)
  const keyLen = Math.ceil(keyBits / 8);
  const key = Buffer.alloc(keyLen);
  for (let i = 0; i < keyLen; i++) key[i] = h[i % h.length];
  return key;
}

function aesCbcDecrypt(data: Buffer, key: Buffer, iv: Buffer, blockSize: number): Buffer {
  // AES block size는 항상 16, keyBits에 따라 aes-128 / aes-192 / aes-256 결정
  const keyBits = key.length * 8;
  const algo = `aes-${keyBits}-cbc`;
  // IV는 정확히 blockSize(=16) 바이트로 잘라냄/패딩
  const ivFixed = Buffer.alloc(blockSize);
  iv.copy(ivFixed, 0, 0, Math.min(iv.length, blockSize));
  const decipher = crypto.createDecipheriv(algo, key, ivFixed);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export async function decryptOOXML(buffer: Buffer, password: string): Promise<Buffer> {
  // 1. OLE CFB 파싱
  const compound = CFB.read(buffer, { type: "buffer" });

  // 2. EncryptionInfo 스트림 읽기
  const encInfoEntry = CFB.find(compound, "EncryptionInfo");
  if (!encInfoEntry) throw new Error("EncryptionInfo 스트림이 없습니다. 파일 형식을 확인해주세요.");
  const encInfoBuf = Buffer.from(encInfoEntry.content);

  // versionMajor 확인: 4 = Agile, 2/3 = Standard
  const versionMajor = encInfoBuf.readUInt16LE(0);
  if (versionMajor !== 4) {
    throw new Error(`지원하지 않는 암호화 버전입니다 (major=${versionMajor}). xlsx 형식 파일을 사용해주세요.`);
  }

  // 8바이트 헤더 이후 XML 추출
  let xmlStart = 8;
  for (let o = 8; o < Math.min(encInfoBuf.length, 20); o++) {
    if (encInfoBuf[o] === 0x3c || encInfoBuf[o] === 0xef) { xmlStart = o; break; }
  }
  const xml = encInfoBuf.slice(xmlStart).toString("utf8").replace(/\0/g, "");

  // 3. 태그 파싱
  const kdTag = findTag(xml, "keyData");
  const ekTag = findTag(xml, "encryptedKey");
  if (!kdTag) throw new Error(`keyData 태그 없음. XML: ${xml.slice(0, 400)}`);
  if (!ekTag) throw new Error(`encryptedKey 태그 없음. XML: ${xml.slice(0, 400)}`);

  // keyData 파라미터 (파일 본체 암호화에 사용)
  const kdSalt      = Buffer.from(getAttr(kdTag, "saltValue"), "base64");
  const kdKeyBits   = parseInt(getAttr(kdTag, "keyBits") || "256");
  const kdBlockSize = parseInt(getAttr(kdTag, "blockSize") || "16");
  const kdHashAlgo  = getAttr(kdTag, "hashAlgorithm") || "SHA512";

  // encryptedKey 파라미터 (키 암호화에 사용)
  const ekSalt      = Buffer.from(getAttr(ekTag, "saltValue"), "base64");
  const ekSpinCount = parseInt(getAttr(ekTag, "spinCount") || "100000");
  const ekKeyBits   = parseInt(getAttr(ekTag, "keyBits") || "256");
  const ekBlockSize = parseInt(getAttr(ekTag, "blockSize") || "16");
  const ekHashAlgo  = getAttr(ekTag, "hashAlgorithm") || "SHA512";
  const encKeyValue = Buffer.from(getAttr(ekTag, "encryptedKeyValue"), "base64");

  if (!ekSalt.length || !encKeyValue.length) {
    throw new Error(`encryptedKey 속성 파싱 실패. 태그: ${ekTag}`);
  }

  // 4. 비밀번호로 키 유도 → encryptedKeyValue 복호화 → secretKey
  const derivedKey = deriveCipherKey(password, ekSalt, ekSpinCount, ekKeyBits, ekBlockSize, ekHashAlgo);
  const decryptedKeyFull = aesCbcDecrypt(encKeyValue, derivedKey, ekSalt, ekBlockSize);
  const secretKey = decryptedKeyFull.slice(0, kdKeyBits / 8);

  // 5. EncryptedPackage 스트림 읽기
  const pkgEntry = CFB.find(compound, "EncryptedPackage");
  if (!pkgEntry) throw new Error("EncryptedPackage 스트림이 없습니다.");
  const pkgBuf = Buffer.from(pkgEntry.content);

  const unencryptedSize = Number(pkgBuf.readBigUInt64LE(0));
  const encData = pkgBuf.slice(8);

  // 6. 4096바이트 세그먼트 단위 복호화
  const SEG = 4096;
  const chunks: Buffer[] = [];
  const hashAlgo = normHashAlgo(kdHashAlgo);

  for (let i = 0; i * SEG < encData.length; i++) {
    const seg = encData.slice(i * SEG, (i + 1) * SEG);
    const segIdx = Buffer.alloc(4);
    segIdx.writeUInt32LE(i, 0);
    // IV = H(kdSalt || segIdx)[0..blockSize-1]
    const iv = crypto.createHash(hashAlgo).update(kdSalt).update(segIdx).digest();
    chunks.push(aesCbcDecrypt(seg, secretKey, iv, kdBlockSize));
  }

  const result = Buffer.concat(chunks).slice(0, unencryptedSize);

  // ZIP magic bytes 검증 (PK = 0x50 0x4B)
  if (result[0] !== 0x50 || result[1] !== 0x4b) {
    throw new Error("복호화 실패: 비밀번호가 틀렸습니다. 주민번호 앞 6자리를 확인해주세요.");
  }

  return result;
}
