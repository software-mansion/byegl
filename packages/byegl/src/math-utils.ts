/**
 * @param value
 * @param modulo has to be power of 2
 */
export function roundUp(value: number, modulo: number) {
  const bitMask = modulo - 1;
  const invBitMask = ~bitMask;
  return (value & bitMask) === 0 ? value : (value & invBitMask) + modulo;
}
