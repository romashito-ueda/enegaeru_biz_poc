// TRACE canonical encoding v1: sorted UTF-8 object keys; each JSON number is
// replaced by its big-endian IEEE-754 binary64 hex. This avoids 1/1.0 and
// exponent-format differences between JS and Python without rounding inputs.
export function canonicalInput(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite input');
    const data = new DataView(new ArrayBuffer(8));
    data.setFloat64(0, Object.is(value, -0) ? 0 : value, false);
    return `d${Array.from(new Uint8Array(data.buffer), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  if (value === null) return 'n';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (typeof value === 'string') return `s${JSON.stringify(value)}`;
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const encoder = new TextEncoder();
    const compareUtf8 = (a: string, b: string) => {
      const aa = encoder.encode(a),
        bb = encoder.encode(b);
      for (let i = 0; i < Math.min(aa.length, bb.length); i++)
        if (aa[i] !== bb[i]) return aa[i] - bb[i];
      return aa.length - bb.length;
    };
    return `{${Object.keys(obj)
      .sort(compareUtf8)
      .map((k) => `${canonicalInput(k)}:${canonicalInput(obj[k])}`)
      .join(',')}}`;
  }
  throw new Error('Expected JSON data');
}
export async function inputHash(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalInput(input));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
