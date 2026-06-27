/**
 * ECMA-376 Agile Encryption 복호화 (Office 2007+, AES-256-CBC)
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

// namespace prefix 포함 속성 추출 (e.g. <p:encryptedKey saltValue="..." />)
function getAttr(xml: string, attrName: string): string {
  const m = xml.match(new RegExp(`\\b${attrName}="([^"]+)"`));
  return m ? m[1] : "";
}

// 특정 태그 (namespace 무관) 찾아서 전체 태그 문자열 반환
function findTag(xml: string, localName: string): string | null {
  // <anything:localName ... /> 또는 <localName ... /> 모두 매치
  const re = new RegExp(`<[\\w:]*${localName}\\b([^>]*)>`, "i");
  const m = xml.match(re);
  return m ? m[0] : null;
}

function deriveKey(
  password: string,
  salt: Buffer,
  spinCount: number,
  keyBits: number,
  hashAlgo: string
): Buffer {
  const algo = hashAlgo.toLowerCase().replace(/-/g, "");
  const pwBytes = utf16le(password);

  let h = crypto.createHash(algo).update(salt).update(pwBytes).digest();
  for (let i = 0; i < spinCount; i++) {
    const ib = Buffer.alloc(4);
    ib.writeUInt32LE(i, 0);
    h = crypto.createHash(algo).update(ib).update(h).digest();
  }
  const block0 = Buffer.alloc(4, 0);
  h = crypto.createHash(algo).update(h).update(block0).digest();

  const keyLen = keyBits / 8;
  const key = Buffer.alloc(keyLen);
  h.copy(key, 0, 0, Math.min(h.length, keyLen));
  return key;
}

function aesDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export async function decryptOOXML(buffer: Buffer, password: string): Promise<Buffer> {
  // 1. OLE CFB 파싱
  const compound = CFB.read(buffer, { type: "buffer" });

  // 2. EncryptionInfo 읽기
  const encInfoEntry = CFB.find(compound, "EncryptionInfo");
  if (!encInfoEntry) throw new Error("EncryptionInfo 스트림이 없습니다. 파일 형식을 확인해주세요.");
  const encInfoBuf = Buffer.from(encInfoEntry.content);

  // versionMajor(2) + versionMinor(2) + reserved(4) = 8바이트 헤더
  // Agile: major=4, minor=4  /  Standard: major=2 or 3
  const versionMajor = encInfoBuf.readUInt16LE(0);
  if (versionMajor !== 4) {
    throw new Error(`지원하지 않는 암호화 버전입니다 (major=${versionMajor}). Agile 암호화(xlsx)만 지원합니다.`);
  }

  // XML 시작 위치 찾기: 8바이트 고정 헤더 이후
  let xmlStart = 8;
  // BOM 또는 <?xml 찾기 (일부 구현은 추가 바이트를 포함)
  for (let offset = 8; offset < Math.min(encInfoBuf.length, 20); offset++) {
    const ch = encInfoBuf[offset];
    if (ch === 0x3c /* '<' */ || ch === 0xef /* UTF-8 BOM */) {
      xmlStart = offset;
      break;
    }
  }

  const xml = encInfoBuf.slice(xmlStart).toString("utf8").replace(/\0/g, "");

  // 3. keyData 태그 파싱
  const kdTag = findTag(xml, "keyData");
  if (!kdTag) {
    throw new Error(`keyData 태그를 찾을 수 없습니다. XML 앞부분: ${xml.slice(0, 300)}`);
  }

  // 4. encryptedKey 태그 파싱
  const ekTag = findTag(xml, "encryptedKey");
  if (!ekTag) {
    throw new Error(`encryptedKey 태그를 찾을 수 없습니다. XML 앞부분: ${xml.slice(0, 300)}`);
  }

  const kdSalt = Buffer.from(getAttr(kdTag, "saltValue"), "base64");
  const kdKeyBits = parseInt(getAttr(kdTag, "keyBits") || "256");
  const kdHashAlgo = getAttr(kdTag, "hashAlgorithm") || "SHA512";

  const ekSalt = Buffer.from(getAttr(ekTag, "saltValue"), "base64");
  const ekSpinCount = parseInt(getAttr(ekTag, "spinCount") || "100000");
  const ekKeyBits = parseInt(getAttr(ekTag, "keyBits") || "256");
  const ekHashAlgo = getAttr(ekTag, "hashAlgorithm") || "SHA512";
  const encKeyValue = Buffer.from(getAttr(ekTag, "encryptedKeyValue"), "base64");

  if (!ekSalt.length || !encKeyValue.length) {
    throw new Error(`encryptedKey 속성 누락. 태그: ${ekTag}`);
  }

  // 5. 비밀번호로 키 유도 → secretKey 복호화
  const derivedKey = deriveKey(password, ekSalt, ekSpinCount, ekKeyBits, ekHashAlgo);
  const secretKey = aesDecrypt(encKeyValue, derivedKey, ekSalt).slice(0, kdKeyBits / 8);

  // 6. EncryptedPackage 읽기
  const pkgEntry = CFB.find(compound, "EncryptedPackage");
  if (!pkgEntry) throw new Error("EncryptedPackage 스트림이 없습니다.");
  const pkgBuf = Buffer.from(pkgEntry.content);

  const unencryptedSize = Number(pkgBuf.readBigUInt64LE(0));
  const encData = pkgBuf.slice(8);

  // 7. 4096바이트 세그먼트 복호화
  const SEG = 4096;
  const chunks: Buffer[] = [];
  const hashAlgo = kdHashAlgo.toLowerCase().replace(/-/g, "");

  for (let i = 0; i * SEG < encData.length; i++) {
    const seg = encData.slice(i * SEG, (i + 1) * SEG);
    const segIdx = Buffer.alloc(4);
    segIdx.writeUInt32LE(i, 0);
    const iv = crypto.createHash(hashAlgo).update(kdSalt).update(segIdx).digest().slice(0, 16);
    chunks.push(aesDecrypt(seg, secretKey, iv));
  }

  const result = Buffer.concat(chunks).slice(0, unencryptedSize);

  // 검증: ZIP magic bytes (PK = 0x50 0x4B)
  if (result[0] !== 0x50 || result[1] !== 0x4b) {
    throw new Error("복호화 실패: 비밀번호가 틀렸거나 지원하지 않는 암호화 방식입니다.");
  }

  return result;
}
