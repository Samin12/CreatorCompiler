// FFmpeg recursively parses arithmetic. A left-associated sum of hundreds of
// cursor samples can exceed its parser depth even when the render is small.
// Balance the addition tree without dropping samples or changing their timing.
export function filterSum(terms: string[]): string {
  if (!terms.length) return "0";
  const join = (start: number, end: number): string => {
    if (end - start === 1) return terms[start];
    const middle = start + Math.floor((end - start) / 2);
    return `(${join(start, middle)}+${join(middle, end)})`;
  };
  return join(0, terms.length);
}
