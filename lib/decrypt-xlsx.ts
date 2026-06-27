/**
 * ECMA-376 Agile Encryption 복호화
 * 참조: msoffcrypto-tool (Python) ecma376_agile.py 기준
 */
import crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CFB = require("cfb") as {
  read: (buf: Buffer, opts: { type: string }) => unknown;
  find: (cfb: unknown, path: string) => { content: Uint8Array } | null;
};

// encryptedKeyValue 용 블록 키 (ECMA-376-4 Table 4)
const BLOCK_KEY_ENC_KEY = Buffer.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

function getAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  return m ? m[1] : "";
}

function findTag(xml: string, localName: string): string | null {
  const re = new RegExp(`<[\\w:]*${localName}\\b[^>]*>`, "i");
  const m = xml.match(re);
  return m ? m[0] : null;
}

function normAlgo(a: string): string {
  return a.toLowerCase().replace(/-/g, "");
}

/**
 * ECMA-376 §4.3.4.2 키 유도 (msoffcrypto-tool 동일 알고리즘)
 *
 * 1. H0 = H(salt || utf16le(password))
 * 2. Hi = H(H_{i-1} || i_LE32)   for i = 0..spinCount-1
 * 3. Hb = H(Hspincount || blockKey)
 * 4. key = H(0_LE32 || Hb)[0..keyLen-1]   ← 이 단계가 핵심
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
  // Node.js 내장 utf16le 인코딩 사용
  const pw = Buffer.from(password, "utf16le");

  // Step 1
  let h = crypto.createHash(algo).update(salt).update(pw).digest();

  // Step 2: H(H_{i-1} || i)
  for (let i = 0; i < spinCount; i++) {
    const ib = Buffer.alloc(4);
    ib.writeUInt32LE(i, 0);
    h = crypto.createHash(algo).update(h).update(ib).digest();
  }

  // Step 3: H(Hspincount || blockKey)
  h = crypto.createHash(algo).update(h).update(blockKey).digest();

  // Step 4: 키 머티리얼 생성 — H(i_LE32 || h) 반복 후 잘라냄
  const keyLen = keyBits / 8;
  const hashLen = h.length;
  const numBlocks = Math.ceil(keyLen / hashLen);
  let keyMaterial = Buffer.alloc(0);

  for (let i = 0; i < numBlocks; i++) {
    const ib = Buffer.alloc(4);
    ib.writeUInt32LE(i, 0);
    // 순서 주의: i 먼저, h 나중
    const block = crypto.createHash(algo).update(ib).update(h).digest();
    keyMaterial = Buffer.concat([keyMaterial, block]);
  }

  return keyMaterial.slice(0, keyLen);
}

function aesCbcDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const algo = `aes-${key.length * 8}-cbc`;
  const iv16 = Buffer.alloc(16);
  iv.copy(iv16, 0, 0, Math.min(iv.length, 16));
  const dec = crypto.createDecipheriv(algo, key, iv16);
  dec.setAutoPadding(false);
  return Buffer.concat([dec.update(data), dec.final()]);
}

export async function decryptOOXML(buffer: Buffer, password: string): Promise<Buffer> {
  // 1. OLE CFB 파싱
  const compound = CFB.read(buffer, { type: "buffer" });

  // 2. EncryptionInfo
  const encInfoEntry = CFB.find(compound, "EncryptionInfo");
  if (!encInfoEntry) throw new Error("EncryptionInfo 스트림이 없습니다.");
  const encInfoBuf = Buffer.from(encInfoEntry.content);

  const versionMajor = encInfoBuf.readUInt16LE(0);
  if (versionMajor !== 4) {
    throw new Error(`지원하지 않는 암호화 버전 (major=${versionMajor})`);
  }

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

  const kdSalt      = Buffer.from(getAttr(kdTag, "saltValue"), "base64");
  const kdKeyBits   = parseInt(getAttr(kdTag, "keyBits") || "256");
  const kdHashAlgo  = getAttr(kdTag, "hashAlgorithm") || "SHA512";

  const ekSalt      = Buffer.from(getAttr(ekTag, "saltValue"), "base64");
  const ekSpinCount = parseInt(getAttr(ekTag, "spinCount") || "100000");
  const ekKeyBits   = parseInt(getAttr(ekTag, "keyBits") || "256");
  const ekHashAlgo  = getAttr(ekTag, "hashAlgorithm") || "SHA512";
  const encKeyValue = Buffer.from(getAttr(ekTag, "encryptedKeyValue"), "base64");

  if (!ekSalt.length || !encKeyValue.length) {
    throw new Error(`속성 파싱 실패. ekTag: ${ekTag.slice(0, 200)}`);
  }

  // 4. 비밀번호 → derivedKey → secretKey
  const derivedKey  = deriveKey(password, ekSalt, ekSpinCount, ekKeyBits, ekHashAlgo, BLOCK_KEY_ENC_KEY);
  const secretKey   = aesCbcDecrypt(encKeyValue, derivedKey, ekSalt).slice(0, kdKeyBits / 8);

  // 5. EncryptedPackage 복호화
  const pkgEntry = CFB.find(compound, "EncryptedPackage");
  if (!pkgEntry) throw new Error("EncryptedPackage 스트림이 없습니다.");
  const pkgBuf = Buffer.from(pkgEntry.content);

  const unencryptedSize = Number(pkgBuf.readBigUInt64LE(0));
  const encData = pkgBuf.slice(8);

  const SEG = 4096;
  const chunks: Buffer[] = [];
  const kdAlgo = normAlgo(kdHashAlgo);

  for (let i = 0; i * SEG < encData.length; i++) {
    const seg = encData.slice(i * SEG, (i + 1) * SEG);
    const segIdx = Buffer.alloc(4);
    segIdx.writeUInt32LE(i, 0);
    const iv = crypto.createHash(kdAlgo).update(kdSalt).update(segIdx).digest();
    chunks.push(aesCbcDecrypt(seg, secretKey, iv));
  }

  const result = Buffer.concat(chunks).slice(0, unencryptedSize);

  if (result[0] !== 0x50 || result[1] !== 0x4b) {
    throw new Error("비밀번호가 틀렸습니다. 주민번호 앞 6자리를 확인해주세요.");
  }

  return result;
}
