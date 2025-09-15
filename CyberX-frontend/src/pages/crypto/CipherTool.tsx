import React, { useState, useMemo } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";

/**
 * CipherTool.tsx
 * Self-contained classical cipher encoder/decoder UI.
 *
 * Drop into src/pages/ and register route in your app-router.
 */

type Algo = "caesar" | "vigenere" | "playfair" | "railfence" | "affine" | "xor";
type Mode = "encode" | "decode";

const DEFAULT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function sanitizeAlpha(s: string) {
  return Array.from(new Set(s.toUpperCase().replace(/[^A-Z]/g, "").split(""))).join("");
}

/* -------------------------
   Utility helpers
   ------------------------- */

const mod = (n: number, m: number) => ((n % m) + m) % m;

const toLettersOnly = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

/* -------------------------
   Caesar
   ------------------------- */
function caesar(input: string, shift: number, mode: Mode, alphabet = DEFAULT_ALPHABET) {
  const A = alphabet;
  const n = A.length;
  const map = new Map<string, number>();
  A.split("").forEach((c, i) => map.set(c, i));

  let out = "";
  for (const ch of input) {
    const up = ch.toUpperCase();
    if (map.has(up)) {
      const idx = map.get(up)!;
      const delta = mode === "encode" ? shift : -shift;
      out += A[mod(idx + delta, n)];
    } else out += ch;
  }
  return out;
}

/* -------------------------
   Vigenere
   ------------------------- */
function vigenere(input: string, key: string, mode: Mode, alphabet = DEFAULT_ALPHABET) {
  const A = alphabet;
  const n = A.length;
  const map = new Map<string, number>();
  A.split("").forEach((c, i) => map.set(c, i));
  const keyLetters = toLettersOnly(key);
  if (!keyLetters) return input;

  let ki = 0;
  let out = "";
  for (const ch of input) {
    const up = ch.toUpperCase();
    if (map.has(up)) {
      const k = map.get(keyLetters[ki % keyLetters.length])!;
      const idx = map.get(up)!;
      const delta = mode === "encode" ? k : -k;
      out += A[mod(idx + delta, n)];
      ki++;
    } else out += ch;
  }
  return out;
}

/* -------------------------
   Playfair
   ------------------------- */
function buildPlayfairTable(key: string) {
  const K = toLettersOnly(key).replace(/J/g, "I"); // common I/J combine
  const seen = new Set<string>();
  const table: string[] = [];
  for (const c of K) {
    if (!seen.has(c)) {
      table.push(c);
      seen.add(c);
    }
  }
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (c === "J") continue; // skip J
    if (!seen.has(c)) {
      table.push(c);
      seen.add(c);
    }
  }
  return table; // length 25
}

function playfairPairsprep(text: string) {
  // Prepare: remove non-letters, J->I, then make digraphs with filler 'X'
  let s = toLettersOnly(text).replace(/J/g, "I");
  const pairs: string[] = [];
  for (let i = 0; i < s.length; ) {
    const a = s[i];
    const b = s[i + 1];
    if (!b) {
      pairs.push(a + "X");
      break;
    }
    if (a === b) {
      pairs.push(a + "X");
      i += 1;
    } else {
      pairs.push(a + b);
      i += 2;
    }
  }
  return pairs;
}

function playfairTransform(text: string, key: string, mode: Mode) {
  const table = buildPlayfairTable(key);
  const pos = new Map<string, { r: number; c: number }>();
  for (let i = 0; i < 25; i++) {
    pos.set(table[i], { r: Math.floor(i / 5), c: i % 5 });
  }
  const pairs = playfairPairsprep(text);
  const outPairs: string[] = [];

  for (const pair of pairs) {
    const A = pair[0];
    const B = pair[1];
    const pa = pos.get(A)!;
    const pb = pos.get(B)!;
    let A2 = "";
    let B2 = "";
    if (pa.r === pb.r) {
      // same row: shift columns
      const shift = mode === "encode" ? 1 : -1;
      A2 = table[pa.r * 5 + mod(pa.c + shift, 5)];
      B2 = table[pb.r * 5 + mod(pb.c + shift, 5)];
    } else if (pa.c === pb.c) {
      // same column: shift rows
      const shift = mode === "encode" ? 1 : -1;
      A2 = table[mod(pa.r + shift, 5) * 5 + pa.c];
      B2 = table[mod(pb.r + shift, 5) * 5 + pb.c];
    } else {
      // rectangle: swap columns
      A2 = table[pa.r * 5 + pb.c];
      B2 = table[pb.r * 5 + pa.c];
    }
    outPairs.push(A2 + B2);
  }

  // Re-insert non-letters? For simplicity return only transformed letters
  return outPairs.join("");
}

/* -------------------------
   Rail Fence
   ------------------------- */
function railFenceEncode(text: string, rails: number) {
  if (rails <= 1) return text;
  const rows: string[] = Array.from({ length: rails }).map(() => "");
  let r = 0;
  let dir = 1;
  for (const ch of text) {
    rows[r] += ch;
    r += dir;
    if (r === rails) {
      r = rails - 2;
      dir = -1;
    } else if (r < 0) {
      r = 1;
      dir = 1;
    }
  }
  return rows.join("");
}

function railFenceDecode(cipher: string, rails: number) {
  if (rails <= 1) return cipher;
  // mark path
  const len = cipher.length;
  const mark = Array.from({ length: rails }).map(() => Array(len).fill(false));
  let r = 0;
  let dir = 1;
  for (let i = 0; i < len; i++) {
    mark[r][i] = true;
    r += dir;
    if (r === rails) {
      r = rails - 2;
      dir = -1;
    } else if (r < 0) {
      r = 1;
      dir = 1;
    }
  }
  // fill letters row-wise
  const rows: string[] = Array.from({ length: rails }).map(() => "");
  let idx = 0;
  for (let rr = 0; rr < rails; rr++) {
    for (let c = 0; c < len; c++) {
      if (mark[rr][c]) {
        rows[rr] += cipher[idx++]!;
      }
    }
  }
  // read by path
  let out = "";
  r = 0;
  dir = 1;
  const curs: number[] = Array(rails).fill(0);
  for (let i = 0; i < len; i++) {
    out += rows[r][curs[r]++];
    r += dir;
    if (r === rails) {
      r = rails - 2;
      dir = -1;
    } else if (r < 0) {
      r = 1;
      dir = 1;
    }
  }
  return out;
}

/* -------------------------
   Affine
   encode: (a*x + b) mod m
   decode: a_inv * (y - b) mod m
   ------------------------- */
function egcd(a: number, b: number): [number, number, number] {
  if (b === 0) return [a, 1, 0];
  const [g, x1, y1] = egcd(b, a % b);
  return [g, y1, x1 - Math.floor(a / b) * y1];
}
function modInv(a: number, m: number) {
  const [g, x] = ((): [number, number] => {
    const r = egcd(a, m);
    return [r[0], r[1]];
  })();
  if (g !== 1) return null;
  return mod((egcd(a, m)[1]), m);
}
function affineTransform(input: string, a: number, b: number, mode: Mode, alphabet = DEFAULT_ALPHABET) {
  const A = alphabet;
  const m = A.length;
  const map = new Map<string, number>();
  A.split("").forEach((c, i) => map.set(c, i));
  let aInv: number | null = null;
  if (mode === "decode") {
    // compute modular inverse of a
    // using egcd
    const inv = ((): number | null => {
      const r = egcd(a, m);
      if (r[0] !== 1) return null;
      return mod(r[1], m);
    })();
    aInv = inv;
    if (aInv === null) throw new Error("a not invertible mod alphabet length");
  }

  let out = "";
  for (const ch of input) {
    const up = ch.toUpperCase();
    if (map.has(up)) {
      const x = map.get(up)!;
      if (mode === "encode") {
        out += A[mod(a * x + b, m)];
      } else {
        out += A[mod(aInv! * (x - b), m)];
      }
    } else out += ch;
  }
  return out;
}

/* -------------------------
   XOR (byte-wise)
   ------------------------- */
function xorBytes(input: string, key: string, mode: Mode) {
  // treat both as utf-8 bytes
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const ib = encoder.encode(input);
  const kb = encoder.encode(key || "key");
  const out = new Uint8Array(ib.length);
  for (let i = 0; i < ib.length; i++) out[i] = ib[i] ^ kb[i % kb.length];
  // for encode produce base64; for decode accept base64 input
  if (mode === "encode") {
    return btoa(String.fromCharCode(...Array.from(out)));
  } else {
    // expecting base64 input in `input`; if our 'input' is raw string it will fail gracefully
    try {
      const raw = atob(input);
      const rb = new Uint8Array(Array.from(raw, (c) => c.charCodeAt(0)));
      const dec = new Uint8Array(rb.length);
      for (let i = 0; i < rb.length; i++) dec[i] = rb[i] ^ kb[i % kb.length];
      return decoder.decode(dec);
    } catch (e) {
      // if not base64, try XOR direct
      return decoder.decode(out);
    }
  }
}

/* -------------------------
   React UI component
   ------------------------- */

export default function CipherTool() {
  const [algo, setAlgo] = useState<Algo>("caesar");
  const [mode, setMode] = useState<Mode>("encode");
  const [input, setInput] = useState<string>("Hello, CyberX!");
  const [key, setKey] = useState<string>("KEY");
  const [shift, setShift] = useState<number>(3);
  const [railCount, setRailCount] = useState<number>(3);
  const [affA, setAffA] = useState<number>(5);
  const [affB, setAffB] = useState<number>(8);
  const [alphabet, setAlphabet] = useState<string>(DEFAULT_ALPHABET);
  const [output, setOutput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const computed = useMemo(() => {
    try {
      setError(null);
      switch (algo) {
        case "caesar":
          return caesar(input, shift, mode, alphabet);
        case "vigenere":
          return vigenere(input, key, mode, alphabet);
        case "playfair":
          return playfairTransform(input, key || "KEY", mode);
        case "railfence":
          return mode === "encode" ? railFenceEncode(input, railCount) : railFenceDecode(input, railCount);
        case "affine":
          return affineTransform(input, affA, affB, mode, alphabet);
        case "xor":
          if (mode === "encode") return xorBytes(input, key || "key", "encode");
          else return xorBytes(input, key || "key", "decode");
        default:
          return input;
      }
    } catch (e: any) {
      setError(String(e?.message || e));
      return "";
    }
  }, [algo, mode, input, key, shift, railCount, affA, affB, alphabet]);

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🔐 Cipher Encoder / Decoder"
        message="Encode or decode classical ciphers. For learning and testing only."
        confirmText="Apply"
        cancelText="Clear"
        onConfirm={() => setOutput(computed)}
        onCancel={() => { setInput(""); setOutput(""); setError(null); }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={920}
      >
        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-3 items-center">
            <select value={algo} onChange={(e) => setAlgo(e.target.value as Algo)} className="p-3 rounded bg-black/20 border border-red-500 text-white">
              <option value="caesar">Caesar (shift)</option>
              <option value="vigenere">Vigenère</option>
              <option value="playfair">Playfair</option>
              <option value="railfence">Rail Fence</option>
              <option value="affine">Affine</option>
              <option value="xor">XOR (base64)</option>
            </select>

            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="p-3 rounded bg-black/20 border border-zinc-700 text-white">
              <option value="encode">Encode</option>
              <option value="decode">Decode</option>
            </select>

            <input value={alphabet} onChange={(e) => setAlphabet(sanitizeAlpha(e.target.value) || DEFAULT_ALPHABET)} className="p-3 rounded bg-black/20 border border-zinc-700 text-white" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)} className="col-span-2 p-3 rounded bg-black/20 border border-zinc-700 text-white" placeholder="Input text (plaintext or ciphertext)" />
            <div className="space-y-3">
              {/* algorithm-specific controls */}
              {algo === "caesar" && (
                <div>
                  <label className="text-sm text-gray-300">Shift</label>
                  <input type="number" value={shift} onChange={(e) => setShift(Number(e.target.value))} className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
                </div>
              )}
              {algo === "vigenere" && (
                <div>
                  <label className="text-sm text-gray-300">Key</label>
                  <input value={key} onChange={(e) => setKey(e.target.value)} className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
                </div>
              )}
              {algo === "playfair" && (
                <div>
                  <label className="text-sm text-gray-300">Key</label>
                  <input value={key} onChange={(e) => setKey(e.target.value)} className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
                  <p className="text-xs text-gray-400 mt-1">Playfair uses I/J combined and strips non-letters.</p>
                </div>
              )}
              {algo === "railfence" && (
                <div>
                  <label className="text-sm text-gray-300">Rails</label>
                  <input type="number" min={2} value={railCount} onChange={(e) => setRailCount(Number(e.target.value))} className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
                </div>
              )}
              {algo === "affine" && (
                <div>
                  <label className="text-sm text-gray-300">a (must be invertible)</label>
                  <input type="number" value={affA} onChange={(e) => setAffA(Number(e.target.value))} className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
                  <label className="text-sm text-gray-300 mt-2">b</label>
                  <input type="number" value={affB} onChange={(e) => setAffB(Number(e.target.value))} className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
                </div>
              )}
              {algo === "xor" && (
                <div>
                  <label className="text-sm text-gray-300">Key (string)</label>
                  <input value={key} onChange={(e) => setKey(e.target.value)} className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
                  <p className="text-xs text-gray-400 mt-1">Encode produces Base64; decode expects Base64 input.</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <button onClick={() => setOutput(computed)} className="bg-red-500 px-4 py-2 rounded">Apply</button>
            <button onClick={() => { navigator.clipboard?.writeText(computed); }} className="bg-zinc-800 px-3 py-2 rounded">Copy Result</button>
            <button onClick={() => { setInput(output); setOutput(""); }} className="bg-zinc-800 px-3 py-2 rounded">Swap In</button>
            <div className="ml-auto text-sm text-gray-400">Result updates when you press Apply</div>
          </div>

          {error && <div className="text-red-400">{error}</div>}

          <div className="bg-black/10 rounded p-3 border border-red-500 mt-2">
            <label className="text-sm text-gray-300">Output</label>
            <textarea readOnly rows={6} value={output} className="w-full p-3 rounded bg-transparent border-none text-white" />
          </div>
        </div>
      </CyberpunkCard>
    </div>
  );
}
