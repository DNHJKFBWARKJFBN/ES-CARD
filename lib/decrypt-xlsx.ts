/**
 * ECMA-376 Agile Encryption 복호화 (Office 2007+, AES-256-CBC)
 * SheetJS 커뮤니티 버전은 AES 암호화 미지원 → Node crypto로 직접 구현
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

function regexAttr(str: string, attr: string): string {
  const m = str.match(new RegExp(`${attr}="([^"]+)"`));
  return m ? m[1] : "";
}

function deriveKey(password: string, salt: Buffer, spinCount: number, keyBits: number, hashAlgo: string): Buffer {
  const algo = hashAlgo.toLowerCase().replace("-", "");
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

  // 2. EncryptionInfo 읽기 (앞 8바이트 헤더 제거 후 XML)
  const encInfoEntry = CFB.find(compound, "EncryptionInfo");
  if (!encInfoEntry) throw new Error("EncryptionInfo 스트림을 찾을 수 없습니다.");
  const encInfoBuf = Buffer.from(encInfoEntry.content);
  const xml = encInfoBuf.slice(8).toString("utf8");

  // 3. XML에서 파라미터 추출
  const kdMatch = xml.match(/<[^:>]*keyData\s([^>]+)>/);
  const ekMatch = xml.match(/<[^:>]*encryptedKey\s([^>]+)>/);
  if (!kdMatch || !ekMatch) throw new Error("암호화 파라미터를 찾을 수 없습니다.");

  const kd = kdMatch[1];
  const ek = ekMatch[1];

  const kdSalt = Buffer.from(regexAttr(kd, "saltValue"), "base64");
  const kdKeyBits = parseInt(regexAttr(kd, "keyBits") || "256");
  const kdHashAlgo = regexAttr(kd, "hashAlgorithm") || "SHA512";

  const ekSalt = Buffer.from(regexAttr(ek, "saltValue"), "base64");
  const ekSpinCount = parseInt(regexAttr(ek, "spinCount") || "100000");
  const ekKeyBits = parseInt(regexAttr(ek, "keyBits") || "256");
  const ekHashAlgo = regexAttr(ek, "hashAlgorithm") || "SHA512";
  const encKeyValue = Buffer.from(regexAttr(ek, "encryptedKeyValue"), "base64");

  // 4. 비밀번호로 키 유도 → secretKey 복호화
  const derivedKey = deriveKey(password, ekSalt, ekSpinCount, ekKeyBits, ekHashAlgo);
  const secretKey = aesDecrypt(encKeyValue, derivedKey, ekSalt).slice(0, kdKeyBits / 8);

  // 5. EncryptedPackage 읽기
  const pkgEntry = CFB.find(compound, "EncryptedPackage");
  if (!pkgEntry) throw new Error("EncryptedPackage 스트림을 찾을 수 없습니다.");
  const pkgBuf = Buffer.from(pkgEntry.content);

  const unencryptedSize = Number(pkgBuf.readBigUInt64LE(0));
  const encData = pkgBuf.slice(8);

  // 6. 4096바이트 세그먼트 단위 복호화
  const SEG = 4096;
  const chunks: Buffer[] = [];
  const hashAlgo = kdHashAlgo.toLowerCase().replace("-", "");

  for (let i = 0; i * SEG < encData.length; i++) {
    const seg = encData.slice(i * SEG, (i + 1) * SEG);
    const segIdx = Buffer.alloc(4);
    segIdx.writeUInt32LE(i, 0);
    // IV = first blockSize bytes of H(kdSalt + segmentIndex)
    const iv = crypto.createHash(hashAlgo).update(kdSalt).update(segIdx).digest().slice(0, 16);
    chunks.push(aesDecrypt(seg, secretKey, iv));
  }

  return Buffer.concat(chunks).slice(0, unencryptedSize);
}
