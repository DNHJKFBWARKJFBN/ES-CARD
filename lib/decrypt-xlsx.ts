/**
 * ECMA-376 Agile Encryption 복호화 (Office 2007+, AES-CBC)
 * Spec: ECMA-376-4 §4.3.4 — msoffcrypto-tool 기준 검증
 */
import crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CFB = require("cfb") as {
  read: (buf: Buffer, opts: { type: string }) => unknown;
  find: (cfb: unknown, path: string) => { content: Uint8Array } | null;
};

// 용도별 블록 키 (ECMA-376-4 Table 4)
const BLOCK_KEY_ENC_KEY = Buffer.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

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
  const re = new RegExp(`<[\\w:]*${localName}\\b[^>]*>`, "i");
  const m = xml.match(re);
  return m ? m[0] : null;
}

function normAlgo(algo: string): string {
  return algo.toLowerCase().replace(/-/g, "");
}

/**
 * ECMA-376 §4.3.4.2 키 유도
 * H0 = H(salt || utf16le(password))
 * Hi = H(H_{i-1} || i_LE32)          ← 순서 주의: prev 먼저
 * Hf = H(H_spinCount || blockKey)     ← blockKey는 용도별 8바이트
 */
function deriveKey(
  password: string,
  salt: Buffer,
  spinCount: number,
  keyBits: number,
  hashAlgo: string,
  blockKey: Buffer
): Buffer {
  const algo = normAlgo(hashAlgo);
  const pw = utf16le(password);

  // H0
  let h = crypto.createHash(algo).update(salt).update(pw).digest();

  // H1 ~ Hspincount : H(H_{i-1} || i)
  for (let i = 0; i < spinCount; i++) {
    const ib = Buffer.alloc(4);
    ib.writeUInt32LE(i, 0);
    h = crypto.createHash(algo).update(h).update(ib).digest();
  }

  // Hfinal : H(Hspincount || blockKey)
  h = crypto.createHash(algo).update(h).update(blockKey).digest();

  // keyBits/8 바이트로 맞춤 (해시가 짧으면 반복 채움)
  const keyLen = keyBits / 8;
  const key = Buffer.alloc(keyLen);
  for (let i = 0; i < keyLen; i++) key[i] = h[i % h.length];
  return key;
}

function aesCbcDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const algo = `aes-${key.length * 8}-cbc`;
  // IV는 정확히 16바이트 (AES block size)
  const iv16 = Buffer.alloc(16);
  iv.copy(iv16, 0, 0, Math.min(iv.length, 16));
  const dec = crypto.createDecipheriv(algo, key, iv16);
  dec.setAutoPadding(false);
  return Buffer.concat([dec.update(data), dec.final()]);
}

export async function decryptOOXML(buffer: Buffer, password: string): Promise<Buffer> {
  // 1. OLE CFB 파싱
  const compound = CFB.read(buffer, { type: "buffer" });

  // 2. EncryptionInfo 읽기
  const encInfoEntry = CFB.find(compound, "EncryptionInfo");
  if (!encInfoEntry) throw new Error("EncryptionInfo 스트림이 없습니다.");
  const encInfoBuf = Buffer.from(encInfoEntry.content);

  const versionMajor = encInfoBuf.readUInt16LE(0);
  if (versionMajor !== 4) {
    throw new Error(`지원하지 않는 암호화 버전 (major=${versionMajor}). xlsx 파일을 사용해주세요.`);
  }

  // 8바이트 헤더 이후 XML
  let xmlStart = 8;
  for (let o = 8; o < Math.min(encInfoBuf.length, 20); o++) {
    if (encInfoBuf[o] === 0x3c || encInfoBuf[o] === 0xef) { xmlStart = o; break; }
  }
  const xml = encInfoBuf.slice(xmlStart).toString("utf8").replace(/\0/g, "");

  // 3. 태그 파싱
  const kdTag = findTag(xml, "keyData");
  const ekTag = findTag(xml, "encryptedKey");
  if (!kdTag) throw new Error(`keyData 없음. XML: ${xml.slice(0, 300)}`);
  if (!ekTag) throw new Error(`encryptedKey 없음. XML: ${xml.slice(0, 300)}`);

  // keyData (파일 본체 암호화)
  const kdSalt      = Buffer.from(getAttr(kdTag, "saltValue"), "base64");
  const kdKeyBits   = parseInt(getAttr(kdTag, "keyBits") || "256");
  const kdHashAlgo  = getAttr(kdTag, "hashAlgorithm") || "SHA512";

  // encryptedKey (키 암호화)
  const ekSalt      = Buffer.from(getAttr(ekTag, "saltValue"), "base64");
  const ekSpinCount = parseInt(getAttr(ekTag, "spinCount") || "100000");
  const ekKeyBits   = parseInt(getAttr(ekTag, "keyBits") || "256");
  const ekHashAlgo  = getAttr(ekTag, "hashAlgorithm") || "SHA512";
  const encKeyValue = Buffer.from(getAttr(ekTag, "encryptedKeyValue"), "base64");

  if (!ekSalt.length || !encKeyValue.length) {
    throw new Error(`encryptedKey 속성 파싱 실패. 태그: ${ekTag}`);
  }

  // 4. 비밀번호로 키 유도 → secretKey 복호화
  const derivedKey = deriveKey(password, ekSalt, ekSpinCount, ekKeyBits, ekHashAlgo, BLOCK_KEY_ENC_KEY);
  const decryptedKeyFull = aesCbcDecrypt(encKeyValue, derivedKey, ekSalt);
  const secretKey = decryptedKeyFull.slice(0, kdKeyBits / 8);

  // 5. EncryptedPackage
  const pkgEntry = CFB.find(compound, "EncryptedPackage");
  if (!pkgEntry) throw new Error("EncryptedPackage 스트림이 없습니다.");
  const pkgBuf = Buffer.from(pkgEntry.content);

  const unencryptedSize = Number(pkgBuf.readBigUInt64LE(0));
  const encData = pkgBuf.slice(8);

  // 6. 4096바이트 세그먼트 복호화
  const SEG = 4096;
  const chunks: Buffer[] = [];
  const kdAlgo = normAlgo(kdHashAlgo);

  for (let i = 0; i * SEG < encData.length; i++) {
    const seg = encData.slice(i * SEG, (i + 1) * SEG);
    const segIdx = Buffer.alloc(4);
    segIdx.writeUInt32LE(i, 0);
    // IV = H(kdSalt || segIdx)[0..15]
    const iv = crypto.createHash(kdAlgo).update(kdSalt).update(segIdx).digest();
    chunks.push(aesCbcDecrypt(seg, secretKey, iv));
  }

  const result = Buffer.concat(chunks).slice(0, unencryptedSize);

  // ZIP magic bytes 검증 (PK = 0x50 0x4B)
  if (result[0] !== 0x50 || result[1] !== 0x4b) {
    throw new Error("복호화 실패: 비밀번호가 틀렸습니다. 주민번호 앞 6자리를 확인해주세요.");
  }

  return result;
}
