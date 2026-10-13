export const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
export const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
export const hex = (text: string): Uint8Array =>
  Uint8Array.from((text.replace(/\s+/g, '').match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
